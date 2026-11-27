import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { eventosEnCola } from "./crm.ts";
import { logger } from "./log.ts";
import { numeroValido } from "./mensajes.ts";
import {
  SesionAjena,
  SinConexion,
  conectar,
  desconectar,
  enviarTexto,
  escribiendo,
  estadoActual,
  leerAdjunto,
  limpiarAdjuntos,
  retomar,
} from "./whatsapp.ts";

/**
 * Puente de WhatsApp por QR para MDFK CRM.
 *
 * Vive en la red interna del servidor, SIN dominio público: solo el CRM le
 * habla, con la misma `BOT_API_KEY`. Guarda la sesión de WhatsApp en
 * `DATA_DIR` (un volumen: si se pierde, hay que volver a escanear) y le avisa
 * al CRM de cada mensaje.
 *
 * Variables: `BOT_API_KEY` (la misma del CRM), `CRM_URL` (dirección interna
 * del CRM, p. ej. http://mdfk_crm:3000), `PORT` (3001), `DATA_DIR` (/data).
 */

const PORT = Number(process.env.PORT ?? 3001);
const TOPE_CUERPO = 64 * 1024;
const TOPE_TEXTO = 4096;

function llaveValida(req: http.IncomingMessage): boolean {
  const esperada = process.env.BOT_API_KEY ?? "";
  if (esperada.length < 16) return false;
  const h = req.headers["x-api-key"];
  const dada = Array.isArray(h) ? h[0] : h;
  if (!dada) return false;
  const a = Buffer.from(dada);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function leerCuerpo(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  let largo = 0;
  for await (const parte of req) {
    largo += (parte as Buffer).length;
    if (largo > TOPE_CUERPO) throw new Error("cuerpo demasiado grande");
    partes.push(parte as Buffer);
  }
  if (largo === 0) return {};
  const v = JSON.parse(Buffer.concat(partes).toString("utf8")) as unknown;
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://puente");
  const ruta = url.pathname;
  try {
    // Salud, sin llave: la usa el healthcheck del contenedor. No revela nada.
    if (req.method === "GET" && ruta === "/health") {
      return json(res, 200, { ok: true, whatsapp: estadoActual().status, enCola: eventosEnCola() });
    }
    if (!llaveValida(req)) return json(res, 401, { error: "No autorizado" });

    if (req.method === "GET" && ruta === "/estado") return json(res, 200, estadoActual());

    if (req.method === "POST" && ruta === "/conectar") {
      const body = await leerCuerpo(req);
      const sesion = typeof body.sesion === "string" ? body.sesion.trim() : "";
      if (!sesion || sesion.length > 200) return json(res, 400, { error: "Falta la sesión" });
      return json(res, 200, await conectar(sesion));
    }

    if (req.method === "POST" && ruta === "/desconectar") return json(res, 200, await desconectar());

    if (req.method === "POST" && ruta === "/enviar") {
      const body = await leerCuerpo(req);
      const to = numeroValido(body.to);
      const text = typeof body.text === "string" ? body.text : "";
      if (!to) return json(res, 400, { error: "Número inválido" });
      if (!text.trim() || text.length > TOPE_TEXTO) return json(res, 400, { error: "Texto vacío o demasiado largo" });
      return json(res, 200, { id: await enviarTexto(to, text) });
    }

    if (req.method === "POST" && ruta === "/escribiendo") {
      const body = await leerCuerpo(req);
      const to = numeroValido(body.to);
      if (to) await escribiendo(to);
      res.writeHead(204).end();
      return;
    }

    const media = /^\/media\/([^/]+)$/.exec(ruta);
    if (req.method === "GET" && media) {
      const adj = leerAdjunto(decodeURIComponent(media[1]!));
      if (!adj) return json(res, 404, { error: "No existe" });
      res.writeHead(200, {
        "content-type": adj.mime ?? "application/octet-stream",
        "content-length": String(adj.data.length),
        "cache-control": "no-store",
      });
      res.end(adj.data);
      return;
    }

    return json(res, 404, { error: "No existe" });
  } catch (err) {
    if (err instanceof SesionAjena) return json(res, 409, { error: err.message });
    if (err instanceof SinConexion) return json(res, 503, { error: err.message });
    if (err instanceof SyntaxError) return json(res, 400, { error: "JSON inválido" });
    logger.error({ err: err instanceof Error ? err.message : String(err) }, `[http] ${req.method} ${ruta}`);
    return json(res, 500, { error: "Error interno del puente" });
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason: String(reason) }, "[puente] promesa rechazada sin capturar (el proceso sigue vivo)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: err.message }, "[puente] excepción no capturada (el proceso sigue vivo)");
});

if ((process.env.BOT_API_KEY ?? "").length < 16) {
  logger.error("[puente] falta BOT_API_KEY (16+ caracteres, la misma del CRM): todo responderá 401");
}
if (!process.env.CRM_URL) {
  logger.error("[puente] falta CRM_URL (la dirección interna del CRM): los mensajes esperarán en cola");
}

servidor.listen(PORT, "0.0.0.0", () => {
  logger.info(`[puente] escuchando en :${PORT}`);
  void retomar().catch((err) => logger.error({ err: String(err) }, "[puente] no se pudo retomar la sesión"));
});
setInterval(limpiarAdjuntos, 60 * 60 * 1000).unref();

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    logger.info(`[puente] ${senal}: cerrando`);
    servidor.close();
    process.exit(0);
  });
}
