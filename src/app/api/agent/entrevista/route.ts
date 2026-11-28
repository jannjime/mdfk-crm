import { withAuth } from "@/lib/api";
import * as http from "@/server/http/agent-rubro";

export const dynamic = "force-dynamic";
// La IA puede tardar en armar el asistente completo.
export const maxDuration = 150;

export const POST = withAuth(http.ENTREVISTA);
