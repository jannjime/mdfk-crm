/**
 * El cliente de `/api/bot/*` del CRM (contrato en docs/openapi.json del CRM).
 * Todo con la misma `BOT_API_KEY`. La llave de IA nunca sale del CRM: el
 * cerebro piensa por `/api/bot/llm`.
 */

export class ErrorCrm extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string
  ) {
    super(message);
  }
}

function base(): string {
  return (process.env.CRM_URL ?? "").replace(/\/+$/, "");
}

async function llamar<T>(
  ruta: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH"; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetch(`${base()}${ruta}`, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": process.env.BOT_API_KEY ?? "",
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    let code: string | null = null;
    let msg = `CRM ${res.status} en ${ruta}`;
    try {
      const b = (await res.json()) as { error?: { code?: string; message?: string } };
      code = b.error?.code ?? null;
      if (b.error?.message) msg = `${msg}: ${b.error.message}`;
    } catch {
      // sin cuerpo
    }
    throw new ErrorCrm(res.status, code, msg);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export type Perfil = {
  profile: {
    name: string;
    tone: string | null;
    instructions: string | null;
    escalationRules: string | null;
    greeting: string | null;
    role: string;
    tools: string[];
  };
  kb: string;
  resources?: { label: string; url: string }[];
  llm: { path: string; model: string } | null;
};

export type Contexto = {
  contact: { id: string; name: string | null; phone: string | null; ficha?: Record<string, unknown> };
  conversation: { id: string; aiEnabled: boolean; handoffAt: string | null; windowOpen: boolean };
  lead: { id: string; stageName: string; nextStages: { id: string; name: string }[] } | null;
  adOrigen: { headline: string | null; body: string | null } | null;
  /** Solo con la agenda encendida. */
  booking?: {
    timezone: string;
    next: { label: string; startUtc: string } | null;
    unresolved: { label: string } | null;
    lastClosed: { label: string; status: string } | null;
  } | null;
};

export type Hueco = { startUtc: string; label: string; dayLabel?: string; time?: string };

/** Huecos libres (quedan registrados como ofrecidos a esa conversación). null = sin agenda. */
export async function huecos(conversationId: string, fecha?: string): Promise<Hueco[] | null> {
  const q = new URLSearchParams({ conversationId, limit: "6", perDay: "3" });
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) q.set("date", fecha);
  try {
    const r = await llamar<{ slots?: Hueco[] }>(`/api/bot/availability?${q.toString()}`);
    return r.slots ?? [];
  } catch (err) {
    if (err instanceof ErrorCrm && err.status === 404 && !err.code) return null;
    throw err;
  }
}

export const reservar = (conversationId: string, startUtc: string, notes?: string | null) =>
  llamar<{ bookingId: string; label: string; meetingLink: string | null }>("/api/bot/bookings", {
    method: "POST",
    body: { conversationId, startUtc, notes: notes ?? null },
  });

export const reprogramar = (conversationId: string, startUtc: string) =>
  llamar<{ bookingId: string; label: string }>("/api/bot/bookings", {
    method: "PATCH",
    body: { conversationId, startUtc },
  });

let perfilCache: { valor: Perfil; hasta: number } | null = null;

/** El perfil cambia poco: se guarda 30 s para no pedirlo en cada mensaje. */
export async function perfil(): Promise<Perfil> {
  if (perfilCache && perfilCache.hasta > Date.now()) return perfilCache.valor;
  const valor = await llamar<Perfil>("/api/bot/profile");
  perfilCache = { valor, hasta: Date.now() + 30_000 };
  return valor;
}

export const contexto = (conversationId: string) =>
  llamar<Contexto>(`/api/bot/context?conversationId=${encodeURIComponent(conversationId)}`);

export async function escribiendo(conversationId: string): Promise<void> {
  try {
    await llamar("/api/bot/typing", { method: "POST", body: { conversationId }, timeoutMs: 8_000 });
  } catch {
    // cortesía: nunca detiene el turno
  }
}

export const enviar = (b: {
  conversationId: string;
  text: string;
  dispatchId?: string;
  dropIfSuperseded?: boolean;
}) => llamar<{ messageId: string }>("/api/bot/messages", { method: "POST", body: b });

export const guardarFicha = (conversationId: string, ficha: Record<string, unknown>) =>
  llamar("/api/bot/ficha", { method: "PUT", body: { conversationId, ficha } });

export const moverEtapa = (conversationId: string, stage: string) =>
  llamar<{ changed: boolean; lead: { stageName: string } }>("/api/bot/stage", {
    method: "POST",
    body: { conversationId, stage },
  });

export const pasarAPersona = (conversationId: string, reason: string) =>
  llamar("/api/bot/handoff", { method: "POST", body: { conversationId, reason } });

export type MensajeLlm =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlamadaHerramienta = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Una vuelta del modelo por el proxy del CRM (formato OpenAI). */
export async function pensar(
  ruta: string,
  cuerpo: { model: string; messages: MensajeLlm[]; tools?: unknown[]; temperature?: number; max_tokens?: number }
): Promise<{ content: string | null; tool_calls: LlamadaHerramienta[] }> {
  const r = await llamar<{
    choices?: { message?: { content?: string | null; tool_calls?: LlamadaHerramienta[] } }[];
  }>(`${ruta.replace(/\/+$/, "")}/chat/completions`, { method: "POST", body: cuerpo, timeoutMs: 60_000 });
  const m = r.choices?.[0]?.message;
  return { content: m?.content ?? null, tool_calls: m?.tool_calls ?? [] };
}
