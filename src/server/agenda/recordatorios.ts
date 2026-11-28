import { and, desc, eq, gt, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  decidir,
  LIMITES,
  REGLAS_DE_FABRICA,
  reglasSchema,
  renderRecordatorio,
  type Regla,
} from "@/lib/recordatorios";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { SendError, sendText } from "@/server/inbox/send";

/**
 * 081 — Recordatorios de citas.
 *
 * Cada minuto se miran las citas por venir; a la que le tocó un recordatorio
 * se le manda por su conversación (el canal que sea: WhatsApp por QR, API,
 * Instagram…). Que salga UNA sola vez lo garantiza la base: se reclama con un
 * INSERT sobre la llave única (cita, antelación) antes de enviar. Sin la
 * bandera AGENDA no corre.
 */

export type ConfigRecordatorios = { enabled: boolean; reglas: Regla[] };

export async function leerRecordatorios(organizationId: string): Promise<ConfigRecordatorios> {
  const rows = await getDb()
    .select()
    .from(schema.reminderSettings)
    .where(scoped(schema.reminderSettings.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return { enabled: true, reglas: REGLAS_DE_FABRICA };
  const reglas = reglasSchema.safeParse(row.rules);
  return { enabled: row.enabled, reglas: reglas.success ? reglas.data : REGLAS_DE_FABRICA };
}

export async function guardarRecordatorios(
  organizationId: string,
  c: ConfigRecordatorios
): Promise<ConfigRecordatorios> {
  const reglas = [...c.reglas].sort((a, b) => b.minutosAntes - a.minutosAntes);
  await getDb()
    .insert(schema.reminderSettings)
    .values({ organizationId, enabled: c.enabled, rules: reglas })
    .onConflictDoUpdate({
      target: schema.reminderSettings.organizationId,
      set: { enabled: c.enabled, rules: reglas, updatedAt: new Date() },
    });
  return { enabled: c.enabled, reglas };
}

/** La conversación por la que sale: la de la cita, o la más reciente del contacto. */
async function conversacionDe(organizationId: string, b: typeof schema.booking.$inferSelect) {
  if (b.conversationId) return b.conversationId;
  if (!b.contactId) return null;
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, b.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function anotar(
  id: string,
  status: "enviado" | "fallido" | "omitido",
  detail: string | null,
  messageId: string | null = null
) {
  await getDb()
    .update(schema.bookingReminder)
    .set({ status, detail, messageId, updatedAt: new Date() })
    .where(eq(schema.bookingReminder.id, id));
}

/** Una pasada. Devuelve cuántos recordatorios salieron (para el log y las pruebas). */
export async function tandaRecordatorios(ahora: Date = new Date()): Promise<number> {
  if (!agendaEnabled()) return 0;
  const db = getDb();
  const hasta = new Date(ahora.getTime() + LIMITES.maxMinutos * 60_000);
  const citas = await db
    .select({ booking: schema.booking, contact: schema.contact, org: schema.organization })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .innerJoin(schema.organization, eq(schema.booking.organizationId, schema.organization.id))
    .where(
      and(
        eq(schema.booking.kind, "session"),
        eq(schema.booking.status, "agendada"),
        gt(schema.booking.scheduledAt, ahora),
        lte(schema.booking.scheduledAt, hasta)
      )
    );

  const configs = new Map<string, ConfigRecordatorios>();
  const zonas = new Map<string, string>();
  let enviados = 0;

  for (const { booking: b, contact, org } of citas) {
    let cfg = configs.get(b.organizationId);
    if (!cfg) {
      cfg = await leerRecordatorios(b.organizationId);
      configs.set(b.organizationId, cfg);
    }
    if (!cfg.enabled) continue;

    for (const regla of cfg.reglas) {
      const d = decidir(regla, { inicio: b.scheduledAt, creada: b.createdAt }, ahora);
      if (d === "esperar") continue;

      // Reclamar: si otra pasada (u otra réplica) ya lo tomó, no se repite.
      const id = newId("bookingReminder");
      const reclamado = await db
        .insert(schema.bookingReminder)
        .values({
          id,
          organizationId: b.organizationId,
          bookingId: b.id,
          minutesBefore: regla.minutosAntes,
          status: d === "omitir" ? "omitido" : "enviando",
          detail: d === "omitir" ? "La cita se agendó después de la hora del recordatorio" : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.bookingReminder.id });
      if (!reclamado[0] || d === "omitir") continue;

      const conversationId = await conversacionDe(b.organizationId, b);
      if (!conversationId) {
        await anotar(id, "fallido", "El cliente no tiene conversación por la que escribirle");
        continue;
      }
      let zona = zonas.get(b.organizationId);
      if (!zona) {
        zona = (await getSettings(b.organizationId)).timezone;
        zonas.set(b.organizationId, zona);
      }
      const texto = renderRecordatorio(regla.texto, {
        nombre: contact.name,
        inicio: b.scheduledAt,
        zona,
        negocio: org.name,
        enlace: b.meetingLink,
      });
      try {
        const r = await sendText({ conversationId, organizationId: b.organizationId, text: texto });
        await anotar(id, "enviado", null, r.messageId);
        enviados += 1;
      } catch (err) {
        const motivo =
          err instanceof SendError
            ? err.code === "window_closed"
              ? "WhatsApp (API oficial) no deja escribir pasadas 24 h del último mensaje del cliente sin plantilla"
              : err.message
            : "No se pudo enviar";
        await anotar(id, "fallido", motivo.slice(0, 300));
        console.warn(`[recordatorios] no salió el de la cita ${b.id}: ${motivo}`);
      }
    }
  }
  return enviados;
}

let timer: NodeJS.Timeout | null = null;

/** Arranca el proceso (cada minuto). Solo con la agenda encendida. */
export function iniciarRecordatorios(): void {
  if (timer || !agendaEnabled()) return;
  const pasada = () =>
    void tandaRecordatorios().catch((err) =>
      console.error("[recordatorios] la pasada falló:", err instanceof Error ? err.message : err)
    );
  timer = setInterval(pasada, 60_000);
  timer.unref?.();
  pasada();
  console.log("[boot] recordatorios de citas activos");
}
