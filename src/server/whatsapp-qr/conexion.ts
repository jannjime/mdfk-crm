import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 080 — La fila del número conectado por QR de cada organización.
 *
 * La fuente de verdad del estado es el puente (es quien tiene la sesión);
 * esta fila es su último reporte, para que la bandeja, la guía de inicio y
 * el envío no le pregunten al puente en cada pantalla, y para saber de qué
 * organización es la sesión que nombra cada evento.
 */

export type ConexionQr = typeof schema.whatsappQrConnection.$inferSelect;
export type EstadoConexionQr = ConexionQr["status"];

export async function conexionQr(organizationId: string): Promise<ConexionQr | null> {
  const rows = await getDb()
    .select()
    .from(schema.whatsappQrConnection)
    .where(eq(schema.whatsappQrConnection.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** La organización dueña de una sesión del puente, si existe. */
export async function organizacionDeSesion(
  sesion: string
): Promise<{ organizationId: string } | null> {
  if (!sesion) return null;
  const fila = await conexionQr(sesion);
  return fila ? { organizationId: fila.organizationId } : null;
}

/**
 * Guarda el último estado conocido. Idempotente: la crea si no existe.
 * `connectedAt` se fija al pasar a conectado y se borra al desconectar.
 */
export async function guardarEstadoQr(
  organizationId: string,
  estado: {
    status: EstadoConexionQr;
    phone?: string | null;
    profileName?: string | null;
  }
): Promise<ConexionQr> {
  const ahora = new Date();
  const previo = await conexionQr(organizationId);
  const conectado = estado.status === "conectado";
  const valores = {
    status: estado.status,
    phone: conectado ? (estado.phone ?? previo?.phone ?? null) : null,
    profileName: conectado ? (estado.profileName ?? previo?.profileName ?? null) : null,
    connectedAt: conectado ? (previo?.status === "conectado" ? previo.connectedAt : ahora) : null,
    lastSeenAt: ahora,
    updatedAt: ahora,
  };
  const rows = await getDb()
    .insert(schema.whatsappQrConnection)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({
      target: schema.whatsappQrConnection.organizationId,
      set: valores,
    })
    .returning();
  return rows[0]!;
}

/** Señal de vida del puente: llegó algo de esta sesión. */
export async function marcarVistoQr(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.whatsappQrConnection)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.whatsappQrConnection.organizationId, organizationId));
}

/** El estado del puente traducido al de la fila. */
export function estadoDeFila(
  status: "desconectado" | "qr" | "conectando" | "conectado"
): EstadoConexionQr {
  if (status === "conectado") return "conectado";
  if (status === "qr" || status === "conectando") return "esperando_qr";
  return "desconectado";
}
