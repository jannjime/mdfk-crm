import { conSesion } from "@/server/http/compartido";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import {
  conReglaCompletar,
  plantillaSchema,
  rubroDe,
  type ClaveRubro,
  RUBROS,
} from "@/lib/rubros";
import { aplicarPlantilla } from "@/server/rubros/aplicar";
import { generarPlantilla } from "@/server/rubros/generar";

/**
 * MDFK — Plantillas por rubro.
 *
 * `POST /api/agent/rubro`: aplica una plantilla fija (`{ rubro }`) o una que
 * ya se generó y el dueño revisó (`{ plantilla }`, la de «Otros»).
 * `POST /api/agent/rubro/generar`: arma la de «Otros» con la IA, sin aplicar.
 */
const CLAVES = RUBROS.filter((r) => r.plantilla).map((r) => r.clave) as [
  ClaveRubro,
  ...ClaveRubro[],
];

const aplicarSchema = z.union([
  z.object({ rubro: z.enum(CLAVES) }),
  z.object({ plantilla: plantillaSchema }),
]);

export const POST = conSesion(async (session, req: Request) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede cargar una plantilla");
  }
  const body = await parseBody(req, aplicarSchema);
  if (!body.ok) return body.response;
  const plantilla =
    "rubro" in body.data
      ? rubroDe(body.data.rubro)!.plantilla!
      : conReglaCompletar(body.data.plantilla);
  const resumen = await aplicarPlantilla(session.organizationId, plantilla);
  if (!resumen) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({ ok: true, ...resumen });
});

const generarSchema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más de tu negocio (al menos 10 caracteres)")
    .max(1500),
});

export const GENERAR = conSesion(async (session, req: Request) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede generar una plantilla");
  }
  const body = await parseBody(req, generarSchema);
  if (!body.ok) return body.response;
  const r = await generarPlantilla(body.data.descripcion, session.organizationId);
  return Response.json(r);
});
