import fs from "node:fs";
import path from "node:path";
import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { avisarAlCrm, type MensajeCrm } from "./crm.ts";
import { logger } from "./log.ts";
import {
  esChatDirecto,
  extraerContenido,
  idDeArchivoSeguro,
  lidDe,
  numeroCanonico,
  numeroDeJidTelefono,
  segundos,
  type MensajeWa,
} from "./mensajes.ts";

/**
 * La sesión de WhatsApp (una por puente: una instancia del CRM = un negocio).
 *
 * Lo que se mantiene del kit, porque costó aprenderlo en producción:
 * - `fetchLatestBaileysVersion()`: WhatsApp rechaza versiones viejas con 405.
 * - Huella de navegador conocida (`Browsers.macOS("Desktop")`): una propia
 *   dispara el 440 en bucle.
 * - Tras el 440 (sesión reemplazada, típico justo después de escanear) se
 *   espera 15 s antes de reconectar; con menos se entra en bucle.
 * - 401 (se cerró desde el teléfono): las credenciales quedan muertas y se
 *   borran, si no cada arranque reintentaría y nunca saldría un QR nuevo.
 */

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const AUTH_DIR = path.join(DATA_DIR, "auth");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const SESION_FILE = path.join(DATA_DIR, "sesion.json");
/** `@lid` ↔ número real, aprendido de lo que entra; sobrevive a reinicios. */
const LID_FILE = path.join(DATA_DIR, "lid.json");
/** Los adjuntos se guardan hasta que el CRM los copia; un día basta y sobra. */
const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const TOPE_ADJUNTO = 25 * 1024 * 1024;

export type Estado = {
  status: "desconectado" | "qr" | "conectando" | "conectado";
  qr: string | null;
  phone: string | null;
  name: string | null;
  sesion: string | null;
};

let sock: WASocket | null = null;
let reconectar: NodeJS.Timeout | null = null;
let arrancando = false;
const estado: Estado = { status: "desconectado", qr: null, phone: null, name: null, sesion: null };

/** Ids que envió el CRM: su eco no vuelve como «lo escribió una persona». */
const enviadosPorCrm = new Map<string, number>();
/**
 * WhatsApp (2025+) esconde el número detrás de un `@lid` en muchos chats.
 * Lo que el negocio escribe desde el teléfono a esa persona llega con el
 * `@lid` y SIN el número: sin este mapa, el eco abría un contacto nuevo con
 * el `@lid` por nombre en vez de seguir en la conversación de siempre.
 */
const numeroDeLid = new Map<string, string>();
const lidDeNumero = new Map<string, string>();
let guardarLidsPendiente: NodeJS.Timeout | null = null;
/** `@lid` de personas que nunca mostraron su número: su «número» en el CRM es el `@lid`. */
const esLidSinNumero = new Set<string>();
/** Ids ya avisados (WhatsApp a veces entrega dos veces el mismo). */
const avisados = new Map<string, number>();

const silencioso = pino({ level: "silent" });

for (const dir of [DATA_DIR, MEDIA_DIR]) fs.mkdirSync(dir, { recursive: true });

try {
  const guardado = JSON.parse(fs.readFileSync(LID_FILE, "utf8")) as Record<string, string>;
  for (const [lid, numero] of Object.entries(guardado)) {
    numeroDeLid.set(lid, numero);
    lidDeNumero.set(numero, lid);
  }
} catch {
  // sin archivo todavía
}

/** Aprende que un `@lid` es tal número. Se guarda en disco con calma (agrupado). */
function aprenderLid(lid: string | null, numero: string | null): void {
  if (!lid || !numero || lid === numero) return;
  if (numeroDeLid.get(lid) === numero) return;
  numeroDeLid.set(lid, numero);
  lidDeNumero.set(numero, lid);
  if (guardarLidsPendiente) return;
  guardarLidsPendiente = setTimeout(() => {
    guardarLidsPendiente = null;
    try {
      fs.writeFileSync(LID_FILE, JSON.stringify(Object.fromEntries(numeroDeLid)));
    } catch (err) {
      logger.warn({ err: String(err) }, "[wa] no se pudo guardar el mapa de @lid");
    }
  }, 2_000);
}

/** Lo que WhatsApp cuenta de los contactos trae a veces el par `@lid` ↔ teléfono. */
function aprenderDeContactos(contactos: { id?: string; lid?: string; jid?: string }[] | undefined): void {
  for (const c of contactos ?? []) {
    const lid = lidDe(c.lid) ?? lidDe(c.id);
    const numero = numeroDeJidTelefono(c.jid) ?? numeroDeJidTelefono(c.id);
    aprenderLid(lid, numero);
  }
}

function leerSesion(): string | null {
  try {
    const s = JSON.parse(fs.readFileSync(SESION_FILE, "utf8")) as { sesion?: unknown };
    return typeof s.sesion === "string" && s.sesion ? s.sesion : null;
  } catch {
    return null;
  }
}

function guardarSesion(sesion: string | null): void {
  if (sesion) fs.writeFileSync(SESION_FILE, JSON.stringify({ sesion }));
  else fs.rmSync(SESION_FILE, { force: true });
}

export function estadoActual(): Estado {
  return { ...estado };
}

function cambiar(parcial: Partial<Estado>): void {
  const antes = estado.status;
  Object.assign(estado, parcial);
  if (estado.sesion && (antes !== estado.status || parcial.phone !== undefined)) {
    avisarAlCrm({
      sesion: estado.sesion,
      tipo: "estado",
      // El QR no viaja: el CRM lo pide cuando lo enseña (cambia cada ~20 s).
      estado: { status: estado.status, phone: estado.phone, name: estado.name },
    });
  }
}

function programarReconexion(codigo: number | undefined): void {
  if (reconectar) return;
  const espera = codigo === 440 ? 15_000 : 5_000;
  logger.info(`[wa] reconectando en ${espera / 1000}s (code=${codigo ?? "?"})`);
  reconectar = setTimeout(() => {
    reconectar = null;
    try {
      sock?.end(undefined);
    } catch {
      // ignorar
    }
    sock = null;
    void abrir();
  }, espera);
}

/** Abre (o reabre) el socket con las credenciales guardadas. */
async function abrir(): Promise<void> {
  if (arrancando || !estado.sesion) return;
  arrancando = true;
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      logger.warn("[wa] no se pudo consultar la última versión de WhatsApp Web; se usa la de fábrica");
    }
    const s = makeWASocket({
      version,
      auth: state,
      logger: silencioso,
      browser: Browsers.macOS("Desktop"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = s;
    if (estado.status === "desconectado") cambiar({ status: "conectando" });

    s.ev.on("creds.update", saveCreds);
    s.ev.on("connection.update", (u) => void alCambiarConexion(s, u));
    s.ev.on("messages.upsert", (e) => void alRecibir(s, e.messages, e.type));
    s.ev.on("contacts.upsert", (c) => aprenderDeContactos(c));
    s.ev.on("contacts.update", (c) => aprenderDeContactos(c as { id?: string; lid?: string; jid?: string }[]));
    s.ev.on("messaging-history.set", (h) => aprenderDeContactos(h.contacts));
  } finally {
    arrancando = false;
  }
}

async function alCambiarConexion(
  s: WASocket,
  u: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }
): Promise<void> {
  if (s !== sock) return; // un socket viejo
  if (u.qr) {
    const qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
    cambiar({ status: "qr", qr, phone: null, name: null });
  }
  if (u.connection === "open") {
    const phone = (s.user?.id ?? "").split(":")[0]?.split("@")[0] || null;
    cambiar({ status: "conectado", qr: null, phone, name: s.user?.name ?? null });
    logger.info(`[wa] conectado (***${phone?.slice(-4) ?? ""})`);
  }
  if (u.connection === "close") {
    const err = u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
    const codigo = err?.output?.statusCode;
    if (codigo === DisconnectReason.loggedOut) {
      logger.info("[wa] la sesión se cerró desde el teléfono: se borran las credenciales");
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      sock = null;
      cambiar({ status: "desconectado", qr: null, phone: null, name: null });
      // Sigue siendo la sesión de este CRM: un QR nuevo, listo para volver a vincular.
      programarReconexion(undefined);
      return;
    }
    // Cualquier otro cierre: se reconecta sin tocar el estado (un parpadeo no es «desconectado»).
    programarReconexion(codigo);
  }
}

function limpiarMapas(): void {
  const hace = Date.now() - 6 * 60 * 60 * 1000;
  for (const m of [enviadosPorCrm, avisados]) {
    for (const [k, t] of m) if (t < hace) m.delete(k);
  }
}

async function guardarAdjunto(s: WASocket, msg: WAMessage, id: string, mime: string | null): Promise<string | null> {
  const seguro = idDeArchivoSeguro(id);
  if (!seguro) return null;
  try {
    const data = await downloadMediaMessage(msg, "buffer", {}, {
      logger: silencioso,
      reuploadRequest: s.updateMediaMessage,
    });
    if (data.length > TOPE_ADJUNTO) return null;
    fs.writeFileSync(path.join(MEDIA_DIR, seguro), data);
    fs.writeFileSync(path.join(MEDIA_DIR, `${seguro}.json`), JSON.stringify({ mime }));
    return seguro;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[wa] no se pudo bajar un adjunto");
    return null;
  }
}

async function alRecibir(s: WASocket, mensajes: WAMessage[], tipo: string): Promise<void> {
  if (!estado.sesion) return;
  // `notify` = en vivo. `append` trae lo escrito desde el teléfono en otro
  // dispositivo; lo que no es en vivo (historial) no entra.
  if (tipo !== "notify" && tipo !== "append") return;
  limpiarMapas();

  for (const msg of mensajes as (WAMessage & MensajeWa)[]) {
    const id = msg.key.id;
    const jid = msg.key.remoteJid;
    if (!id || !esChatDirecto(jid)) continue;
    const deMi = Boolean(msg.key.fromMe);
    if (!deMi && tipo !== "notify") continue;
    if (deMi && enviadosPorCrm.has(id)) continue;
    if (avisados.has(id)) continue;

    const contenido = extraerContenido(msg.message as Record<string, unknown> | null);
    if (!contenido) continue;

    const lid = lidDe(jid);
    // El número real: el que trae el mensaje (`senderPn`, solo en lo que
    // entra) o el aprendido para ese `@lid`.
    const conocido = lid ? (numeroDeJidTelefono(msg.key.senderPn) ?? numeroDeLid.get(lid) ?? null) : null;
    if (lid && conocido) aprenderLid(lid, conocido);
    // Lo que entra sin número conocido usa el `@lid` como identidad (estable
    // para esa persona); un eco sin número viaja con su `@lid` y el CRM lo
    // asigna al contacto que ya escribió por esa dirección.
    const numero = lid ? (conocido ?? (deMi ? null : lid)) : numeroCanonico(jid, msg.key.senderPn);
    if (!numero && !lid) continue;

    let adjunto: MensajeCrm["adjunto"] = null;
    if (contenido.conArchivo) {
      const guardado = await guardarAdjunto(s, msg, id, contenido.mime);
      if (guardado) adjunto = { id: guardado, mime: contenido.mime, nombre: contenido.nombreArchivo };
    }
    avisados.set(id, Date.now());
    if (lid && !conocido && !deMi) esLidSinNumero.add(lid);

    avisarAlCrm({
      sesion: estado.sesion,
      tipo: deMi ? "eco" : "mensaje",
      mensaje: {
        id,
        numero,
        lid,
        nombre: deMi ? null : (msg.pushName ?? null),
        timestamp: segundos(msg.messageTimestamp),
        tipo: contenido.tipo,
        texto: contenido.texto,
        adjunto,
      },
    });
  }
}

/**
 * A dónde se le contesta: al `@lid` por el que escribe esa persona, si se
 * conoce (así sigue el mismo chat), o a su número. Un «número» que en
 * realidad es un `@lid` (alguien que nunca mostró su teléfono) va a su `@lid`.
 */
function direccion(numero: string, lidDelCrm?: string | null): string {
  // El CRM recuerda el `@lid` de cada contacto: manda sobre la memoria del puente.
  if (lidDelCrm) return `${lidDelCrm}@lid`;
  const lid = lidDeNumero.get(numero);
  if (lid) return `${lid}@lid`;
  if (esLidSinNumero.has(numero)) return `${numero}@lid`;
  return `${numero}@s.whatsapp.net`;
}

// --- Lo que pide el CRM ---------------------------------------------------

export class SesionAjena extends Error {}
export class SinConexion extends Error {}

/** Arranca la sesión de esta organización y devuelve el estado (con QR si ya salió). */
export async function conectar(sesion: string): Promise<Estado> {
  if (estado.sesion && estado.sesion !== sesion && estado.status === "conectado") {
    throw new SesionAjena("El puente ya tiene conectado el número de otra instancia");
  }
  if (estado.sesion !== sesion) {
    estado.sesion = sesion;
    guardarSesion(sesion);
  }
  if (!sock && !arrancando) await abrir();
  // Esperar un poco al primer QR para que la pantalla lo enseñe al instante.
  for (let i = 0; i < 20 && estado.status === "conectando"; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return estadoActual();
}

export async function desconectar(): Promise<Estado> {
  const s = sock;
  sock = null;
  if (reconectar) {
    clearTimeout(reconectar);
    reconectar = null;
  }
  if (s) {
    try {
      await s.logout();
    } catch {
      try {
        s.end(undefined);
      } catch {
        // ignorar
      }
    }
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  cambiar({ status: "desconectado", qr: null, phone: null, name: null });
  estado.sesion = null;
  guardarSesion(null);
  return estadoActual();
}

export async function enviarTexto(numero: string, texto: string, lid?: string | null): Promise<string> {
  if (!sock || estado.status !== "conectado") throw new SinConexion("WhatsApp no está conectado");
  const res = await sock.sendMessage(direccion(numero, lid), { text: texto });
  const id = res?.key?.id;
  if (id) enviadosPorCrm.set(id, Date.now());
  return id ?? `local_${Date.now()}`;
}

export async function escribiendo(numero: string, lid?: string | null): Promise<void> {
  if (!sock || estado.status !== "conectado") return;
  await sock.sendPresenceUpdate("composing", direccion(numero, lid)).catch(() => {});
}

/** El archivo de un adjunto entrante, para que el CRM lo copie. */
export function leerAdjunto(id: string): { data: Buffer; mime: string | null } | null {
  const seguro = idDeArchivoSeguro(id);
  if (!seguro) return null;
  const ruta = path.join(MEDIA_DIR, seguro);
  if (!fs.existsSync(ruta)) return null;
  let mime: string | null = null;
  try {
    mime = (JSON.parse(fs.readFileSync(`${ruta}.json`, "utf8")) as { mime?: string | null }).mime ?? null;
  } catch {
    // sin metadatos: el CRM lo adivina por el contenido
  }
  return { data: fs.readFileSync(ruta), mime };
}

/** Borra los adjuntos viejos: el CRM ya los copió a su volumen. */
export function limpiarAdjuntos(): void {
  const limite = Date.now() - MEDIA_TTL_MS;
  for (const nombre of fs.readdirSync(MEDIA_DIR)) {
    const ruta = path.join(MEDIA_DIR, nombre);
    try {
      if (fs.statSync(ruta).mtimeMs < limite) fs.rmSync(ruta, { force: true });
    } catch {
      // ignorar
    }
  }
}

/** Al arrancar: si había una sesión guardada, se retoma sola (sin QR, si las credenciales siguen vivas). */
export async function retomar(): Promise<void> {
  const sesion = leerSesion();
  if (!sesion) return;
  estado.sesion = sesion;
  await abrir();
}
