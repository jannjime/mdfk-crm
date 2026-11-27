import { requireBridgeKey } from "@/server/bot/auth";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { recibirEvento } from "@/server/webhooks/recibir";

/**
 * 080 — Entrada del puente de WhatsApp por QR.
 *
 * No es un webhook de un tercero: es el puente propio del operador, en su
 * red interna, que avisa de lo que entra por el número conectado. Se
 * autentica con la misma `BOT_API_KEY` que el cerebro (comparación en tiempo
 * constante), y luego corre el MISMO camino que los demás webhooks: guardar
 * el evento antes de procesarlo, para que un reinicio a media ingesta no
 * pierda un mensaje (047).
 *
 * Con el canal apagado, 404: esta superficie no existe en la instancia.
 */
export const dynamic = "force-dynamic";

const TOPE_CUERPO = 256 * 1024;

export async function POST(req: Request) {
  if (!isChannelEnabled("whatsapp_qr")) return channelDisabledResponse();
  const denegado = requireBridgeKey(req);
  if (denegado) return denegado;

  const rawBody = await req.text();
  if (rawBody.length > TOPE_CUERPO) {
    return Response.json({ error: "cuerpo demasiado grande" }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  return recibirEvento("whatsapp_qr", payload, rawBody, "qr");
}
