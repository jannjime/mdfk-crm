import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { reglasSchema } from "@/lib/recordatorios";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { guardarRecordatorios, leerRecordatorios } from "@/server/agenda/recordatorios";

export const dynamic = "force-dynamic";

/** 081 — Ajustes → Agenda → Recordatorios. */
export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  return Response.json(await leerRecordatorios(session.organizationId));
});

const putSchema = z.object({ enabled: z.boolean(), reglas: reglasSchema });

export const PUT = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede cambiar los recordatorios");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return Response.json(await guardarRecordatorios(session.organizationId, body.data));
});
