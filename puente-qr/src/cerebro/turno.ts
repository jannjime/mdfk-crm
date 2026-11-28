import { logger } from "../log.ts";
import {
  contexto,
  enviar,
  ErrorCrm,
  escribiendo,
  guardarFicha,
  moverEtapa,
  pasarAPersona,
  pensar,
  perfil,
  type Contexto,
  type LlamadaHerramienta,
  type MensajeLlm,
  type Perfil,
} from "./crm-bot.ts";
import { permitidosDe, revisarSalida } from "./guardas.ts";
import { dividirMensajes, pausaEscritura } from "./humanizar.ts";
import { anotar, recordar, type Recuerdo } from "./memoria.ts";
import { armarPrompt } from "./prompt.ts";

/**
 * Un turno: el CRM despacha la ráfaga del cliente, el cerebro piensa con el
 * perfil del negocio y contesta por `/api/bot/messages`. Es el flujo del kit
 * (agrupar, filtrar, memoria, IA con herramientas, humanizar) sobre el
 * contrato del CRM en vez de sobre WhatsApp directo: así contesta igual en
 * WhatsApp (API o QR), Instagram y Messenger.
 */

export type Despacho = {
  dispatchId: string;
  conversation: { id: string; channel: string; aiEnabled: boolean; test?: boolean };
  contact?: { displayName?: string };
  messages: {
    id: string;
    type: string;
    text: string | null;
    caption?: string | null;
    fileName?: string;
    location?: { latitude: number; longitude: number; name?: string; address?: string };
  }[];
  capabilities?: string[];
  relaunch?: number;
  humanAttention?: { messages: { from: "team" | "customer"; type: string; text: string | null }[] };
};

const RESPALDO = "Déjame confirmarte ese dato con el equipo y te escribo en un ratito 🙌";
const MAX_VUELTAS = 4;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lo que dijo el cliente, en texto para la memoria y el modelo. */
export function textoDelMensaje(m: Despacho["messages"][number]): string {
  const t = (m.text ?? "").trim();
  switch (m.type) {
    case "text":
    case "interactive":
    case "button":
      return t;
    case "image":
      return `[El cliente envió una foto${m.caption ? ` con el texto: «${m.caption}»` : ""}. No puedes verla: pregúntale qué necesita si hace falta.]`;
    case "audio":
      return "[El cliente envió una nota de voz. No puedes escucharla: pídele con amabilidad que te lo escriba.]";
    case "video":
      return `[El cliente envió un video${m.caption ? ` con el texto: «${m.caption}»` : ""}.]`;
    case "document":
      return `[El cliente envió un documento${m.fileName ? ` (${m.fileName})` : ""}${m.caption ? `: «${m.caption}»` : ""}.]`;
    case "sticker":
      return "[El cliente envió un sticker.]";
    case "location":
      return `[El cliente compartió una ubicación${m.location?.address ? `: ${m.location.address}` : ""}.]`;
    default:
      return t || `[El cliente envió un mensaje de tipo ${m.type}.]`;
  }
}

function herramientas(p: Perfil, ctx: Contexto | null): unknown[] {
  const tools = new Set(p.profile.tools ?? []);
  const out: unknown[] = [];
  if (tools.has("ficha")) {
    out.push({
      type: "function",
      function: {
        name: "guardar_datos_cliente",
        description: "Guarda en la ficha del cliente lo que aprendiste (nombre, qué busca, distrito, fecha, presupuesto…).",
        parameters: {
          type: "object",
          properties: {
            datos: {
              type: "object",
              description: "Clave → valor en texto corto. Ej.: {\"nombre\":\"Ana\",\"busca\":\"baño para perro mediano\"}",
              additionalProperties: { type: "string" },
            },
          },
          required: ["datos"],
        },
      },
    });
  }
  const siguientes = ctx?.lead?.nextStages ?? [];
  if (tools.has("etapa") && siguientes.length > 0) {
    out.push({
      type: "function",
      function: {
        name: "mover_etapa",
        description: `Mueve al cliente a una etapa siguiente del pipeline. Está en «${ctx?.lead?.stageName}».`,
        parameters: {
          type: "object",
          properties: { etapa: { type: "string", enum: siguientes.map((s) => s.name) } },
          required: ["etapa"],
        },
      },
    });
  }
  out.push({
    type: "function",
    function: {
      name: "pasar_a_persona",
      description: "Pasa la conversación a una persona del equipo (la IA deja de contestar aquí). Despídete antes en tu mensaje.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", enum: ["cliente", "modelo", "hostilidad"] } },
        required: ["motivo"],
      },
    },
  });
  return out;
}

function historial(recuerdos: Recuerdo[]): MensajeLlm[] {
  return recuerdos.map((r) =>
    r.rol === "cliente"
      ? { role: "user" as const, content: r.texto }
      : {
          role: "assistant" as const,
          content: r.rol === "equipo" ? `(Escrito por una persona del equipo) ${r.texto}` : r.texto,
        }
  );
}

async function ejecutar(
  conversationId: string,
  llamada: LlamadaHerramienta,
  estado: { traspaso: string | null }
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(llamada.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    return "Error: argumentos ilegibles.";
  }
  try {
    switch (llamada.function.name) {
      case "guardar_datos_cliente": {
        const datos = args.datos && typeof args.datos === "object" ? (args.datos as Record<string, unknown>) : {};
        const limpios = Object.fromEntries(
          Object.entries(datos)
            .filter(([, v]) => typeof v === "string" && v.trim())
            .slice(0, 12)
            .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 300)])
        );
        if (Object.keys(limpios).length) await guardarFicha(conversationId, limpios);
        return "Guardado.";
      }
      case "mover_etapa": {
        const r = await moverEtapa(conversationId, String(args.etapa ?? ""));
        return r.changed ? `Listo: ahora está en «${r.lead.stageName}».` : "Ya estaba en esa etapa.";
      }
      case "pasar_a_persona":
        // Se hace DESPUÉS de enviar la despedida (el CRM pausa la IA al traspasar).
        estado.traspaso = ["cliente", "modelo", "hostilidad"].includes(String(args.motivo)) ? String(args.motivo) : "cliente";
        return "Hecho: en cuanto te despidas, una persona del equipo sigue la conversación.";
      default:
        return "Herramienta desconocida.";
    }
  } catch (err) {
    return `No se pudo: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Piensa la respuesta, con herramientas, hasta tener texto. */
async function pensarRespuesta(
  p: Perfil,
  ctx: Contexto | null,
  conversationId: string,
  mensajes: MensajeLlm[],
  estado: { traspaso: string | null }
): Promise<string> {
  const llm = p.llm!;
  const tools = herramientas(p, ctx);
  // Lo que el modelo escribió junto con una herramienta: si después no agrega
  // nada, esa era su respuesta.
  let escrito = "";
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const r = await pensar(llm.path, {
      model: llm.model,
      messages: mensajes,
      tools,
      temperature: 0.6,
      max_tokens: 700,
    });
    if (r.tool_calls.length === 0) return (r.content ?? "").trim() || escrito;
    if (r.content?.trim()) escrito = r.content.trim();
    mensajes.push({ role: "assistant", content: r.content ?? null, tool_calls: r.tool_calls });
    for (const t of r.tool_calls) {
      mensajes.push({ role: "tool", tool_call_id: t.id, content: await ejecutar(conversationId, t, estado) });
    }
  }
  if (escrito) return escrito;
  // Se quedó sin texto tras las herramientas (pasaba en el kit): forzar la respuesta.
  const r = await pensar(llm.path, {
    model: llm.model,
    messages: [...mensajes, { role: "system", content: "Ahora escribe tu mensaje al cliente. Solo el texto." }],
    temperature: 0.6,
    max_tokens: 500,
  });
  return (r.content ?? "").trim();
}

export async function atenderTurno(d: Despacho): Promise<void> {
  const convId = d.conversation.id;
  if (!d.conversation.aiEnabled) return;

  const p = await perfil();
  if (!p.llm) {
    logger.warn("[cerebro] sin proveedor de IA en el CRM (Ajustes → IA): no contesto");
    return;
  }
  const ctx = await contexto(convId).catch(() => null);
  if (ctx && (!ctx.conversation.aiEnabled || ctx.conversation.handoffAt)) return;
  void escribiendo(convId);

  // Memoria: lo que el equipo dijo mientras la IA estaba en pausa, y la ráfaga del cliente.
  const ahora = new Date().toISOString();
  const nuevos: Recuerdo[] = [];
  for (const m of d.humanAttention?.messages ?? []) {
    if (m.from === "team" && m.text) nuevos.push({ rol: "equipo", texto: m.text, at: ahora });
  }
  for (const m of d.messages) {
    const t = textoDelMensaje(m);
    if (t) nuevos.push({ rol: "cliente", texto: t, at: ahora, id: m.id });
  }
  anotar(convId, nuevos);

  const mensajes: MensajeLlm[] = [
    { role: "system", content: armarPrompt(p, ctx) },
    ...historial(recordar(convId)),
  ];
  const estado: { traspaso: string | null } = { traspaso: null };

  let texto = await pensarRespuesta(p, ctx, convId, [...mensajes], estado);

  // Filtros de salida (no en el Laboratorio: ahí se evalúa al modelo tal cual).
  if (!d.conversation.test && texto) {
    const permitidos = permitidosDe(
      [p.profile.instructions, p.profile.greeting, p.profile.tone, p.kb, ...(p.resources ?? []).map((r) => r.url)]
        .filter(Boolean)
        .join("\n")
    );
    let rev = revisarSalida(texto, permitidos);
    if (!rev.ok) {
      logger.warn(`[cerebro] respuesta bloqueada (${rev.motivo}); se reescribe`);
      texto = await pensarRespuesta(p, ctx, convId, [
        ...mensajes,
        { role: "assistant", content: texto },
        {
          role: "system",
          content: `Tu respuesta anterior se bloqueó (${rev.motivo}). Reescríbela usando SOLO cifras y enlaces que aparecen en tus datos. Si no tienes ese dato, di que lo confirmas con el equipo.`,
        },
      ], estado);
      rev = revisarSalida(texto, permitidos);
      if (!rev.ok) {
        logger.warn(`[cerebro] bloqueada otra vez (${rev.motivo}); respuesta de respaldo y pasa a una persona`);
        texto = RESPALDO;
        estado.traspaso = estado.traspaso ?? "modelo";
      }
    }
  }

  if (!texto) {
    logger.warn(`[cerebro] el modelo no escribió nada en ${convId}`);
    return; // la red de seguridad del CRM lo relanza
  }

  const partes = dividirMensajes(texto);
  const superable = d.capabilities?.includes("dispatch_superado") ?? false;
  const enviados: string[] = [];
  for (const [i, parte] of partes.entries()) {
    if (i > 0) {
      void escribiendo(convId);
      await esperar(pausaEscritura(parte));
    }
    try {
      await enviar({
        conversationId: convId,
        text: parte,
        ...(superable ? { dispatchId: d.dispatchId, dropIfSuperseded: true } : {}),
      });
      enviados.push(parte);
    } catch (err) {
      if (err instanceof ErrorCrm && (err.code === "dispatch_superado" || err.code === "ai_paused")) {
        // El cliente volvió a escribir (llega otro despacho) o una persona tomó el chat: callar.
        break;
      }
      throw err;
    }
  }
  if (enviados.length) anotar(convId, [{ rol: "agente", texto: enviados.join("\n"), at: new Date().toISOString() }]);
  if (estado.traspaso && enviados.length) {
    await pasarAPersona(convId, estado.traspaso).catch((err) =>
      logger.warn({ err: String(err) }, "[cerebro] no se pudo pasar a una persona")
    );
  }
}
