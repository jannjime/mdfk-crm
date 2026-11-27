import { withAuth } from "@/lib/api";
import * as http from "@/server/http/agent-rubro";

export const dynamic = "force-dynamic";
// La IA puede tardar en armar la plantilla.
export const maxDuration = 120;

export const POST = withAuth(http.GENERAR);
