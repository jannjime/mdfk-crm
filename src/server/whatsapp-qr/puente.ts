import { getEnv } from "@/lib/env";

/**
 * 080 — El cliente del puente de WhatsApp por QR.
 *
 * El puente es un servicio aparte (en la red interna del servidor, sin
 * dominio público) que guarda la sesión web de WhatsApp. El CRM nunca toca
 * esa sesión: le pide el QR, le pide enviar, y el puente le avisa de lo que
 * entra por `POST /api/webhooks/qr`. Los dos se autentican con la misma
 * `BOT_API_KEY` que ya usa el cerebro.
 *
 * Contrato del puente (lo implementa el kit):
 *
 * - `GET  /estado`              → EstadoPuente
 * - `POST /conectar`  {sesion}  → EstadoPuente   (arranca la sesión y su QR)
 * - `POST /desconectar`         → EstadoPuente   (cierra la sesión del teléfono)
 * - `POST /enviar`    {to,text} → { id }
 * - `POST /escribiendo` {to}    → 204
 * - `GET  /media/:id`           → el archivo de un adjunto entrante
 *
 * Cualquier fallo del puente se traduce a `PuenteError` con un motivo que el
 * operador entiende: el puente caído nunca tumba una pantalla del CRM.
 */

export type EstadoPuente = {
  /** `desconectado`: sin sesión. `qr`: esperando escaneo. `conectando`: escaneado, abriendo. */
  status: "desconectado" | "qr" | "conectando" | "conectado";
  /** El QR como data URL (PNG), solo mientras `status` es `qr`. */
  qr: string | null;
  /** El número vinculado, en dígitos. */
  phone: string | null;
  /** El nombre del perfil de WhatsApp del número vinculado. */
  name: string | null;
  /** La organización dueña de la sesión, tal como se le pasó al conectar. */
  sesion: string | null;
};

export class PuenteError extends Error {
  constructor(
    public readonly code: "no_configurado" | "no_responde" | "rechazado",
    message: string
  ) {
    super(message);
    this.name = "PuenteError";
  }
}

const TIMEOUT_MS = 15_000;

/** La URL base del puente, sin barra final; null si no está configurado. */
export function urlDelPuente(): string | null {
  const raw = getEnv().WA_QR_BRIDGE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** ¿Este URL es del puente? Para aceptar sus adjuntos (red interna) y ningún otro. */
export function esDelPuente(url: string): boolean {
  const base = urlDelPuente();
  if (!base) return false;
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function cabeceras(): Record<string, string> {
  const key = process.env.BOT_API_KEY ?? "";
  return { "x-api-key": key, "content-type": "application/json" };
}

async function llamar(
  ruta: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<Response> {
  const base = urlDelPuente();
  if (!base) {
    throw new PuenteError(
      "no_configurado",
      "El puente de WhatsApp por QR no está configurado (WA_QR_BRIDGE_URL)"
    );
  }
  let res: Response;
  try {
    res = await fetch(`${base}${ruta}`, {
      method: init.method,
      headers: cabeceras(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new PuenteError(
      "no_responde",
      "El puente de WhatsApp por QR no responde: revisa que el servicio esté encendido"
    );
  }
  if (!res.ok) {
    let detalle = "";
    try {
      const body = (await res.json()) as { error?: string };
      detalle = typeof body.error === "string" ? `: ${body.error.slice(0, 200)}` : "";
    } catch {
      // sin cuerpo legible
    }
    throw new PuenteError(
      res.status === 401 ? "rechazado" : "no_responde",
      res.status === 401
        ? "El puente rechazó la llave: BOT_API_KEY debe ser la misma en el CRM y en el puente"
        : `El puente respondió ${res.status}${detalle}`
    );
  }
  return res;
}

const STATUS = new Set<EstadoPuente["status"]>([
  "desconectado",
  "qr",
  "conectando",
  "conectado",
]);

/** Pura: lee lo que devuelve el puente sin fiarse de su forma. */
export function leerEstado(raw: unknown): EstadoPuente {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const status = STATUS.has(o.status as EstadoPuente["status"])
    ? (o.status as EstadoPuente["status"])
    : "desconectado";
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const qr = texto(o.qr);
  return {
    status,
    // Solo una imagen embebida: nada que el navegador vaya a pedir a otro host.
    qr: status === "qr" && qr?.startsWith("data:image/") ? qr : null,
    phone: texto(o.phone)?.replace(/\D/g, "") || null,
    name: texto(o.name),
    sesion: texto(o.sesion),
  };
}

export async function estadoDelPuente(): Promise<EstadoPuente> {
  const res = await llamar("/estado");
  return leerEstado(await res.json().catch(() => null));
}

export async function conectarPuente(sesion: string): Promise<EstadoPuente> {
  const res = await llamar("/conectar", { method: "POST", body: { sesion } });
  return leerEstado(await res.json().catch(() => null));
}

export async function desconectarPuente(): Promise<EstadoPuente> {
  const res = await llamar("/desconectar", { method: "POST", body: {} });
  return leerEstado(await res.json().catch(() => null));
}

/** Envía un texto. Devuelve el id del mensaje en WhatsApp. */
export async function enviarPorPuente(to: string, text: string): Promise<string> {
  const res = await llamar("/enviar", { method: "POST", body: { to, text } });
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && body.id ? body.id : null;
  // Sin id no hay con qué deduplicar el eco: se inventa uno estable y único.
  return id ?? `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** «Escribiendo…». Best-effort: un fallo aquí jamás detiene una respuesta. */
export async function escribiendoPorPuente(to: string): Promise<void> {
  try {
    await llamar("/escribiendo", { method: "POST", body: { to } });
  } catch {
    // el aviso es cortesía; el mensaje sale igual
  }
}

/** La URL interna de un adjunto entrante guardado en el puente. */
export function urlDeAdjunto(mediaId: string): string | null {
  const base = urlDelPuente();
  return base ? `${base}/media/${encodeURIComponent(mediaId)}` : null;
}

/** Baja un adjunto del puente (red interna, con la llave). */
export async function bajarAdjuntoDelPuente(
  url: string,
  topeBytes: number
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  if (!esDelPuente(url)) {
    throw new PuenteError("rechazado", "El adjunto no es del puente de WhatsApp por QR");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": process.env.BOT_API_KEY ?? "" },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new PuenteError("no_responde", "El puente no entregó el adjunto");
  }
  if (!res.ok) throw new PuenteError("no_responde", `El puente respondió ${res.status} al adjunto`);
  const largo = Number(res.headers.get("content-length") ?? "0");
  if (largo > topeBytes) throw new PuenteError("rechazado", "El adjunto supera el tamaño permitido");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > topeBytes) throw new PuenteError("rechazado", "El adjunto supera el tamaño permitido");
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || null;
  return { data, mimeType: mime, fileSize: data.length };
}
