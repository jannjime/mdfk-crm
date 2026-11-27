/**
 * Lo puro del puente: qué es cada mensaje de WhatsApp y a quién pertenece.
 * Sin red ni sesión, para poder probarlo.
 *
 * Las reglas de identidad vienen del kit de agente de WhatsApp, probadas en
 * producción: WhatsApp (2025+) entrega algunos chats con dirección `@lid`, un
 * identificador interno que NO es el teléfono; el número real llega en
 * `key.senderPn`. Se usa ese número como identidad (para no partir a la
 * persona en dos) y el `@lid` solo como dirección de respuesta.
 */

/** Lo mínimo de un `WAMessage` que se lee aquí (evita acoplar el tipo entero de Baileys). */
export type MensajeWa = {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    senderPn?: string;
  };
  messageTimestamp?: number | { toNumber(): number } | null;
  pushName?: string | null;
  message?: Record<string, unknown> | null;
};

export type TipoMensaje = "text" | "image" | "video" | "audio" | "document" | "sticker";

export type Contenido = {
  tipo: TipoMensaje;
  texto: string | null;
  /** Hay un archivo que bajar (imagen, audio…). */
  conArchivo: boolean;
  mime: string | null;
  nombreArchivo: string | null;
};

/** ¿Es un chat uno a uno? Grupos, difusiones, estados y canales no entran al CRM. */
export function esChatDirecto(jid: string | null | undefined): jid is string {
  if (!jid) return false;
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) {
    return false;
  }
  if (jid === "status@broadcast") return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

const digitos = (jid: string) => (jid.split("@")[0] ?? "").split(":")[0] ?? "";

/**
 * El número canónico de la persona. En un `@lid` se usa `senderPn` si trae
 * un número real; si no, el del jid (degradado, pero estable).
 */
export function numeroCanonico(remoteJid: string, senderPn?: string): string {
  if (remoteJid.endsWith("@lid") && senderPn && senderPn.includes("@") && /\d/.test(senderPn)) {
    return digitos(senderPn);
  }
  return digitos(remoteJid);
}

/** Desenvuelve los contenedores (mensajes efímeros, «ver una vez», con caption de documento). */
function interior(message: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  let m = message ?? null;
  for (let i = 0; i < 4 && m; i++) {
    const envoltorio =
      (m.ephemeralMessage as { message?: Record<string, unknown> } | undefined) ??
      (m.viewOnceMessage as { message?: Record<string, unknown> } | undefined) ??
      (m.viewOnceMessageV2 as { message?: Record<string, unknown> } | undefined) ??
      (m.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined);
    if (!envoltorio?.message) break;
    m = envoltorio.message;
  }
  return m;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Qué trae el mensaje. null = nada que llevar al CRM (reacciones, encuestas, protocolo…). */
export function extraerContenido(message: Record<string, unknown> | null | undefined): Contenido | null {
  const m = interior(message);
  if (!m) return null;

  const texto =
    str(m.conversation) ??
    str((m.extendedTextMessage as { text?: unknown } | undefined)?.text);
  if (texto) return { tipo: "text", texto, conArchivo: false, mime: null, nombreArchivo: null };

  const medios: [string, TipoMensaje][] = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["documentMessage", "document"],
    ["stickerMessage", "sticker"],
  ];
  for (const [campo, tipo] of medios) {
    const media = m[campo] as
      | { caption?: unknown; mimetype?: unknown; fileName?: unknown }
      | undefined;
    if (media) {
      return {
        tipo,
        texto: str(media.caption),
        conArchivo: true,
        mime: str(media.mimetype)?.split(";")[0]?.trim() ?? null,
        nombreArchivo: str(media.fileName),
      };
    }
  }
  return null;
}

/** El timestamp en segundos, venga como número o como Long. */
export function segundos(ts: MensajeWa["messageTimestamp"]): number {
  if (typeof ts === "number") return ts;
  if (ts && typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber();
  return Math.floor(Date.now() / 1000);
}

/** Solo dígitos, o null si no parece un número de WhatsApp. */
export function numeroValido(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
}

/** Un id de adjunto seguro como nombre de archivo (sin rutas). */
export function idDeArchivoSeguro(id: string): string | null {
  return /^[A-Za-z0-9_-]{4,120}$/.test(id) ? id : null;
}
