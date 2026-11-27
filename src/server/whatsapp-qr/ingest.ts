import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import {
  getOrCreateContactByIdentity,
  QR_IDENTITY_PREFIX,
  type ResolvedIdentity,
} from "@/server/inbox/identity";
import {
  getOrCreateConversation,
  ingestInboundMessage,
  serializeMessage,
  type MediaInput,
} from "@/server/inbox/ingest";
import { pausarIaPorRespuestaManual } from "@/server/inbox/pausa-manual";
import { estadoDeFila, guardarEstadoQr, marcarVistoQr, organizacionDeSesion } from "./conexion";
import { urlDeAdjunto } from "./puente";

/**
 * 080 — Entrada del canal de WhatsApp por QR.
 *
 * El puente manda tres clases de evento, todas con la `sesion` (la
 * organización dueña del número):
 *
 * - `mensaje`: lo que escribió un cliente. Entra por el MISMO núcleo de
 *   ingesta que los demás canales: contacto, conversación, idempotencia por
 *   id, bus de eventos y despacho al cerebro.
 * - `eco`: lo que alguien del negocio escribió desde el teléfono. Se guarda
 *   como saliente manual y pausa la IA, igual que el eco de coexistence de la
 *   API oficial: si una persona ya contestó, la IA no le pisa la respuesta.
 * - `estado`: la sesión cambió (QR nuevo, conectado, cerrada desde el teléfono).
 *
 * La normalización es pura (`normalizarEventoQr`) para poder probar sin base
 * qué se acepta y qué se descarta.
 */

export const QR_PREFIX = QR_IDENTITY_PREFIX;

const TIPOS = ["text", "image", "video", "audio", "document", "sticker"] as const;
type TipoQr = (typeof TIPOS)[number];

const adjunto = z.object({
  id: z.string().min(1).max(200),
  mime: z.string().max(200).nullish(),
  nombre: z.string().max(300).nullish(),
});

const mensaje = z.object({
  id: z.string().min(1).max(200),
  /** El número del cliente (o del destinatario, en un eco), en dígitos. */
  numero: z.string().min(5).max(32),
  nombre: z.string().max(200).nullish(),
  /** Segundos desde epoch. */
  timestamp: z.union([z.number(), z.string()]),
  tipo: z.string().max(40),
  texto: z.string().max(65_536).nullish(),
  adjunto: adjunto.nullish(),
});

const evento = z.discriminatedUnion("tipo", [
  z.object({ sesion: z.string().min(1).max(200), tipo: z.literal("mensaje"), mensaje }),
  z.object({ sesion: z.string().min(1).max(200), tipo: z.literal("eco"), mensaje }),
  z.object({
    sesion: z.string().min(1).max(200),
    tipo: z.literal("estado"),
    estado: z.object({
      status: z.enum(["desconectado", "qr", "conectando", "conectado"]),
      phone: z.string().max(32).nullish(),
      name: z.string().max(200).nullish(),
    }),
  }),
]);

export type EventoQr = z.infer<typeof evento>;

/** El mensaje ya en la forma del núcleo. */
export type MensajeQr = {
  id: string;
  phone: string;
  profileName: string | null;
  timestamp: string;
  type: TipoQr;
  text: string | null;
  adjunto: { id: string; mime: string | null; nombre: string | null } | null;
};

/** Pura: valida el evento. `null` = no es un evento del puente (se descarta con log). */
export function normalizarEventoQr(payload: unknown): EventoQr | null {
  const r = evento.safeParse(payload);
  return r.success ? r.data : null;
}

/** Pura: el mensaje del puente en la forma del núcleo; null si no tiene nada que guardar. */
export function normalizarMensajeQr(m: EventoQr & { tipo: "mensaje" | "eco" }): MensajeQr | null {
  const digitos = m.mensaje.numero.replace(/\D/g, "");
  if (digitos.length < 5) return null;
  const tipo: TipoQr = (TIPOS as readonly string[]).includes(m.mensaje.tipo)
    ? (m.mensaje.tipo as TipoQr)
    : "text";
  const texto = m.mensaje.texto?.trim() ? m.mensaje.texto : null;
  const adj = tipo !== "text" && m.mensaje.adjunto ? m.mensaje.adjunto : null;
  // Un texto vacío sin adjunto no le dice nada al equipo: se descarta.
  if (!texto && !adj) return null;
  const ts = Number(m.mensaje.timestamp);
  return {
    id: m.mensaje.id,
    phone: normalizeMx(digitos),
    profileName: m.mensaje.nombre?.trim() || null,
    timestamp: String(Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : Math.floor(Date.now() / 1000)),
    // Un adjunto que no llegó se guarda como el texto que lo acompañaba.
    type: adj ? tipo : "text",
    text: texto,
    adjunto: adj
      ? { id: adj.id, mime: adj.mime ?? null, nombre: adj.nombre ?? null }
      : null,
  };
}

/** La identidad del contacto: su número, en el espacio del canal QR. */
export function identidadQr(m: MensajeQr): ResolvedIdentity {
  return {
    identity: `${QR_PREFIX}${m.phone}`,
    channel: "whatsapp_qr",
    phone: m.phone,
    waUserId: null,
    profileName: m.profileName,
  };
}

/** El adjunto, pendiente de bajar del puente (en segundo plano, como los demás). */
function mediaDelPuente(m: MensajeQr): MediaInput | null {
  if (!m.adjunto || m.type === "text") return null;
  const url = urlDeAdjunto(m.adjunto.id);
  if (!url) return null;
  return {
    kind: m.type,
    waMediaId: null,
    mimeType: m.adjunto.mime,
    fileName: m.adjunto.nombre,
    caption: m.text,
    payload: { sourceUrl: url, origen: "qr" },
    fetchStatus: "pending",
  };
}

/** El procesador de la fuente `whatsapp_qr` (lo llaman la ruta y el barrido). */
export async function processQrPayload(payload: unknown): Promise<void> {
  const evt = normalizarEventoQr(payload);
  if (!evt) {
    console.warn("[qr] evento del puente con forma desconocida: descartado");
    return;
  }
  const organizationId = evt.sesion;
  // La fila la crea el CRM al pedir el QR: sin ella, la sesión no es de nadie
  // aquí (un puente apuntado al CRM equivocado) y no se inventa organización.
  if (!(await organizacionDeSesion(organizationId))) {
    console.warn("[qr] evento de una sesión que esta instancia no conoce: descartado");
    return;
  }

  if (evt.tipo === "estado") {
    await guardarEstadoQr(organizationId, {
      status: estadoDeFila(evt.estado.status),
      phone: evt.estado.phone?.replace(/\D/g, "") || null,
      profileName: evt.estado.name ?? null,
    });
    return;
  }

  const m = normalizarMensajeQr(evt);
  if (!m) {
    console.warn(`[qr] mensaje ${evt.mensaje.id} sin contenido utilizable: descartado`);
    return;
  }
  await marcarVistoQr(organizationId);

  if (evt.tipo === "mensaje") {
    await ingestInboundMessage({
      organizationId,
      identity: identidadQr(m),
      waMessageId: `${QR_PREFIX}${m.id}`,
      type: m.type,
      text: m.adjunto ? null : m.text,
      timestamp: m.timestamp,
      media: mediaDelPuente(m),
    });
    return;
  }

  await ingestEcoQr(organizationId, m);
}

/**
 * Lo que el negocio escribió desde el teléfono: saliente manual que pausa la
 * IA. Idempotente por id, como todo lo demás. El puente NO manda como eco lo
 * que envió el CRM; y si llegara, el id repetido lo descarta.
 */
async function ingestEcoQr(organizationId: string, m: MensajeQr): Promise<void> {
  const db = getDb();
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    ...identidadQr(m),
    // El nombre del eco es el del negocio, no el del cliente.
    profileName: null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id, {
    channel: "whatsapp_qr",
  });
  const at = new Date(Number(m.timestamp) * 1000);

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: `${QR_PREFIX}${m.id}`,
      direction: "out",
      type: m.adjunto ? m.type : "text",
      text: m.text ?? (m.adjunto ? null : ""),
      status: "sent",
      origin: "manual",
      waTimestamp: at,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  const message = inserted[0];
  if (!message) return; // duplicado

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: at, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  await pausarIaPorRespuestaManual(organizationId, conversation.id, at);

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message, null, null) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });
}
