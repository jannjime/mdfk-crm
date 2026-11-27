import { and, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { plegar, TOPE_RESPUESTAS } from "@/lib/respuestas-rapidas";
import type { Plantilla } from "@/lib/rubros";

/**
 * MDFK — Aplica una plantilla de rubro a la organización, en una transacción.
 *
 * - Agente: REEMPLAZA nombre, tono, instrucciones, escalado y saludo (la
 *   pantalla lo confirma antes). El rol y las herramientas no se tocan.
 * - Etapas: si ninguna etapa abierta tiene leads, se reemplazan por las del
 *   rubro. Si ya hay leads, se conservan para no mover a nadie de lugar.
 *   Ganado y perdido siempre se renombran (un renombre no mueve leads).
 * - Conocimiento y respuestas rápidas: se AGREGAN; lo que ya existe (misma
 *   pregunta o mismo atajo) no se duplica ni se pisa.
 */
export type ResumenAplicar = {
  agente: true;
  etapas: "reemplazadas" | "conservadas";
  conocimientoAgregado: number;
  respuestasAgregadas: number;
};

export async function aplicarPlantilla(
  organizationId: string,
  p: Plantilla
): Promise<ResumenAplicar | null> {
  return getDb().transaction(async (tx) => {
    const perfil = await tx
      .update(schema.agentProfile)
      .set({
        name: p.agente.nombre,
        tone: p.agente.tono,
        instructions: p.agente.instrucciones,
        escalationRules: p.agente.reglasDeEscalado,
        greeting: p.agente.saludo,
        updatedAt: new Date(),
      })
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .returning({ id: schema.agentProfile.id });
    if (!perfil[0]) return null;

    // --- Etapas ---
    const etapas = await tx
      .select()
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId));
    const abiertas = etapas.filter((e) => e.kind === "open");
    const ganada = etapas.find((e) => e.kind === "won");
    const perdida = etapas.find((e) => e.kind === "lost");

    let conLeads = 0;
    if (abiertas.length > 0) {
      const [fila] = await tx
        .select({ n: count() })
        .from(schema.lead)
        .where(
          and(
            scoped(schema.lead.organizationId, organizationId),
            inArray(
              schema.lead.stageId,
              abiertas.map((e) => e.id)
            )
          )
        );
      conLeads = fila?.n ?? 0;
    }

    let estadoEtapas: ResumenAplicar["etapas"] = "conservadas";
    let siguiente = abiertas.length;
    if (conLeads === 0) {
      if (abiertas.length > 0) {
        await tx.delete(schema.pipelineStage).where(
          and(
            scoped(schema.pipelineStage.organizationId, organizationId),
            inArray(
              schema.pipelineStage.id,
              abiertas.map((e) => e.id)
            )
          )
        );
      }
      await tx.insert(schema.pipelineStage).values(
        p.etapas.map((name, i) => ({
          id: newId("stage"),
          organizationId,
          name,
          position: i,
          kind: "open" as const,
        }))
      );
      siguiente = p.etapas.length;
      estadoEtapas = "reemplazadas";
    }
    const anclas: [typeof ganada, string][] = [
      [ganada, p.etapaGanada],
      [perdida, p.etapaPerdida],
    ];
    for (const [ancla, nombre] of anclas) {
      if (!ancla) continue;
      await tx
        .update(schema.pipelineStage)
        .set({
          name: nombre,
          ...(estadoEtapas === "reemplazadas" ? { position: siguiente++ } : {}),
        })
        .where(
          and(
            scoped(schema.pipelineStage.organizationId, organizationId),
            eq(schema.pipelineStage.id, ancla.id)
          )
        );
    }

    // --- Conocimiento (sin duplicar preguntas) ---
    const kb = await tx
      .select({ question: schema.kbEntry.question })
      .from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, organizationId));
    const preguntas = new Set(kb.map((k) => plegar(k.question ?? "").trim()));
    const nuevasKb = p.conocimiento.filter((c) => {
      const clave = plegar(c.pregunta).trim();
      if (preguntas.has(clave)) return false;
      preguntas.add(clave);
      return true;
    });
    if (nuevasKb.length > 0) {
      await tx.insert(schema.kbEntry).values(
        nuevasKb.map((c) => ({
          id: newId("kbEntry"),
          organizationId,
          kind: "qa" as const,
          question: c.pregunta,
          answer: c.respuesta,
          content: null,
        }))
      );
    }

    // --- Respuestas rápidas (sin pisar atajos, dentro del tope) ---
    const qr = await tx
      .select({ atajo: schema.quickReply.atajo })
      .from(schema.quickReply)
      .where(scoped(schema.quickReply.organizationId, organizationId));
    const atajos = new Set(qr.map((q) => q.atajo));
    const libres = Math.max(0, TOPE_RESPUESTAS - qr.length);
    const nuevasQr = p.respuestasRapidas
      .filter((r) => {
        if (atajos.has(r.atajo)) return false;
        atajos.add(r.atajo);
        return true;
      })
      .slice(0, libres);
    if (nuevasQr.length > 0) {
      await tx.insert(schema.quickReply).values(
        nuevasQr.map((r) => ({
          id: newId("quickReply"),
          organizationId,
          atajo: r.atajo,
          texto: r.texto,
        }))
      );
    }

    return {
      agente: true as const,
      etapas: estadoEtapas,
      conocimientoAgregado: nuevasKb.length,
      respuestasAgregadas: nuevasQr.length,
    };
  });
}
