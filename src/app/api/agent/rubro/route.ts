import { withAuth } from "@/lib/api";
import * as http from "@/server/http/agent-rubro";

export const dynamic = "force-dynamic";

export const POST = withAuth(http.POST);
