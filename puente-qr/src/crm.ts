import { logger } from "./log.ts";

/**
 * Los avisos al CRM (`POST {CRM_URL}/api/webhooks/qr`).
 *
 * El CRM guarda cada evento antes de procesarlo, así que basta con que lo
 * ACEPTE una vez. Si no contesta (se está redesplegando, la base parpadeó),
 * el evento espera en una cola en memoria y se reintenta con espera creciente:
 * un reinicio corto del CRM no pierde mensajes. Un 4xx (llave mal puesta,
 * sesión que el CRM no conoce) no se reintenta: repetir no lo arregla.
 */

export type EventoCrm =
  | { sesion: string; tipo: "mensaje" | "eco"; mensaje: MensajeCrm }
  | {
      sesion: string;
      tipo: "estado";
      estado: { status: "desconectado" | "qr" | "conectando" | "conectado"; phone: string | null; name: string | null };
    };

export type MensajeCrm = {
  id: string;
  numero: string;
  nombre: string | null;
  timestamp: number;
  tipo: string;
  texto: string | null;
  adjunto: { id: string; mime: string | null; nombre: string | null } | null;
};

const ESPERAS_MS = [1_000, 3_000, 10_000, 30_000, 60_000, 120_000, 300_000];
const TOPE_COLA = 2_000;

type Pendiente = { evento: EventoCrm; intentos: number; siguiente: number };
const cola: Pendiente[] = [];
let corriendo = false;

function urlCrm(): string | null {
  const raw = process.env.CRM_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

async function entregar(evento: EventoCrm): Promise<"ok" | "reintentar" | "descartar"> {
  const base = urlCrm();
  if (!base) return "reintentar";
  try {
    const res = await fetch(`${base}/api/webhooks/qr`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.BOT_API_KEY ?? "" },
      body: JSON.stringify(evento),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return "ok";
    if (res.status === 404) {
      logger.error("[crm] 404: el canal whatsapp_qr no está encendido en el CRM (CHANNELS)");
      return "reintentar";
    }
    if (res.status === 401) {
      logger.error("[crm] 401: BOT_API_KEY no coincide con la del CRM");
      return "reintentar";
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return "descartar";
    return "reintentar";
  } catch {
    return "reintentar";
  }
}

async function vaciar(): Promise<void> {
  if (corriendo) return;
  corriendo = true;
  try {
    while (cola.length > 0) {
      const p = cola[0]!;
      const espera = p.siguiente - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, Math.min(espera, 5_000)));
      if (p.siguiente > Date.now()) continue;
      const r = await entregar(p.evento);
      if (r === "ok" || r === "descartar") {
        if (r === "descartar") logger.warn(`[crm] el CRM rechazó un evento «${p.evento.tipo}»: descartado`);
        cola.shift();
        continue;
      }
      // En orden: el siguiente evento no se adelanta a uno que no entró.
      p.intentos += 1;
      p.siguiente = Date.now() + (ESPERAS_MS[Math.min(p.intentos - 1, ESPERAS_MS.length - 1)] ?? 300_000);
      if (p.intentos === 3) logger.warn("[crm] el CRM no responde; los mensajes esperan en cola");
    }
  } finally {
    corriendo = false;
  }
}

/** Encola y entrega en orden. Nunca lanza. */
export function avisarAlCrm(evento: EventoCrm): void {
  if (cola.length >= TOPE_COLA) {
    // Proteger la memoria: se pierde lo más viejo, y se dice.
    cola.shift();
    logger.error("[crm] cola llena: se descartó el evento más antiguo");
  }
  cola.push({ evento, intentos: 0, siguiente: 0 });
  void vaciar();
}

export function eventosEnCola(): number {
  return cola.length;
}
