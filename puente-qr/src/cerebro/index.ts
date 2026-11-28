import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../log.ts";
import { olvidar } from "./memoria.ts";
import { atenderTurno, type Despacho } from "./turno.ts";

/**
 * La entrada del cerebro: `BRAIN_DISPATCH_URL` del CRM apunta aquí
 * (`POST /cerebro/despacho`). Verifica la firma, contesta enseguida (el CRM
 * espera 20 s) y piensa después. Un turno por conversación a la vez; si llega
 * otro despacho de la misma conversación mientras se piensa, se encola detrás
 * (el CRM ya descarta las respuestas viejas con `dispatch_superado`).
 */

export function firmaValida(cuerpoCrudo: string, firma: string | undefined): boolean {
  const secreto = process.env.BOT_API_KEY ?? "";
  if (secreto.length < 16 || !firma) return false;
  const esperada = Buffer.from(`sha256=${createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex")}`);
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

const colas = new Map<string, Promise<void>>();
const vistos = new Map<string, number>();

function yaVisto(dispatchId: string, relaunch: number | undefined): boolean {
  const clave = `${dispatchId}:${relaunch ?? 0}`;
  const hace = Date.now() - 60 * 60 * 1000;
  for (const [k, t] of vistos) if (t < hace) vistos.delete(k);
  if (vistos.has(clave)) return true;
  vistos.set(clave, Date.now());
  return false;
}

/** Recibe un cuerpo ya verificado. Devuelve enseguida; el turno corre aparte. */
export function recibirDespacho(cuerpo: unknown, evento: string | undefined): void {
  const c = cuerpo as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return;

  if (evento === "conversation.deleted" || c.type === "conversation.deleted") {
    const id = (c.conversation as { id?: string } | undefined)?.id;
    if (id) olvidar(id);
    return;
  }

  const d = c as unknown as Despacho;
  if (!d.dispatchId || !d.conversation?.id || !Array.isArray(d.messages)) return;
  if (yaVisto(d.dispatchId, d.relaunch)) return;

  const id = d.conversation.id;
  const anterior = colas.get(id) ?? Promise.resolve();
  const siguiente = anterior
    .catch(() => {})
    .then(() => atenderTurno(d))
    .catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, `[cerebro] turno fallido en ${id}`))
    .finally(() => {
      if (colas.get(id) === siguiente) colas.delete(id);
    });
  colas.set(id, siguiente);
}
