import fs from "node:fs";
import path from "node:path";

/**
 * La memoria del cerebro: el CRM no le manda el historial (contrato 036), así
 * que el cerebro recuerda cada conversación en su volumen. Se guardan los
 * últimos turnos, que es lo que el modelo necesita para no repetirse.
 */
const DIR = path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "memoria");
const MAX = 40;
fs.mkdirSync(DIR, { recursive: true });

export type Recuerdo = {
  rol: "cliente" | "agente" | "equipo";
  texto: string;
  at: string;
  /** Id del mensaje en el CRM (los del cliente): un relanzamiento no los duplica. */
  id?: string;
};

function archivo(conversationId: string): string | null {
  return /^[A-Za-z0-9_-]{3,80}$/.test(conversationId) ? path.join(DIR, `${conversationId}.json`) : null;
}

export function recordar(conversationId: string): Recuerdo[] {
  const f = archivo(conversationId);
  if (!f) return [];
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Recuerdo[];
  } catch {
    return [];
  }
}

export function anotar(conversationId: string, nuevos: Recuerdo[]): void {
  const f = archivo(conversationId);
  if (!f || nuevos.length === 0) return;
  const previos = recordar(conversationId);
  const vistos = new Set(previos.map((r) => r.id).filter(Boolean));
  const frescos = nuevos.filter((r) => !r.id || !vistos.has(r.id));
  if (frescos.length === 0) return;
  const todo = [...previos, ...frescos].slice(-MAX);
  fs.writeFileSync(f, JSON.stringify(todo));
}

export function olvidar(conversationId: string): void {
  const f = archivo(conversationId);
  if (f) fs.rmSync(f, { force: true });
}
