import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { isBotKeyConfigured } from "@/server/bot/auth";
import {
  conexionQr,
  estadoDeFila,
  guardarEstadoQr,
  type ConexionQr,
} from "@/server/whatsapp-qr/conexion";
import {
  conectarPuente,
  desconectarPuente,
  estadoDelPuente,
  PuenteError,
  urlDelPuente,
  type EstadoPuente,
} from "@/server/whatsapp-qr/puente";

export const dynamic = "force-dynamic";

/**
 * 080 — Ajustes → WhatsApp (QR).
 *
 * GET pregunta al puente (es quien tiene la sesión) y guarda lo que dice; si
 * el puente no responde, devuelve el último estado guardado y el motivo, para
 * que la pantalla diga qué revisar en vez de quedarse en blanco.
 * POST pide el QR (arranca la sesión de esta organización); DELETE cierra la
 * sesión en el teléfono. Solo quien configura puede conectar o desconectar.
 */

type Respuesta = {
  configurado: boolean;
  puente: EstadoPuente | null;
  error: string | null;
  conexion: {
    status: ConexionQr["status"];
    phone: string | null;
    profileName: string | null;
    connectedAt: string | null;
  } | null;
};

function dto(fila: ConexionQr | null): Respuesta["conexion"] {
  return fila
    ? {
        status: fila.status,
        phone: fila.phone,
        profileName: fila.profileName,
        connectedAt: fila.connectedAt?.toISOString() ?? null,
      }
    : null;
}

function faltaConfig(): string | null {
  if (!urlDelPuente()) return "Falta WA_QR_BRIDGE_URL en el entorno del CRM (la dirección interna del puente).";
  if (!isBotKeyConfigured()) return "Falta BOT_API_KEY (16+ caracteres) en el entorno del CRM; el puente usa la misma.";
  return null;
}

/**
 * Lo que dice el puente, reconciliado con la fila. Si la sesión del puente
 * es de otra organización (un puente compartido por error), no se adopta.
 */
async function sincronizar(organizationId: string, puente: EstadoPuente) {
  const propia = !puente.sesion || puente.sesion === organizationId;
  const previa = await conexionQr(organizationId);
  // Una sesión ajena que solo espera su QR no es un número conectado: para
  // esta organización el puente está libre, y pedir el QR la toma.
  if (!propia && puente.status !== "conectado") {
    return { puente: { ...puente, status: "desconectado" as const, qr: null, phone: null, name: null }, fila: previa };
  }
  if (!propia) return { puente: null, fila: previa };
  // Sin fila y sin sesión no se crea nada: mirar la pantalla no es conectar.
  if (!previa && puente.status === "desconectado") return { puente, fila: null };
  const fila = await guardarEstadoQr(organizationId, {
    status: estadoDeFila(puente.status),
    phone: puente.phone,
    profileName: puente.name,
  });
  return { puente, fila };
}

export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("whatsapp_qr")) return channelDisabledResponse();
  const falta = faltaConfig();
  if (falta) {
    const r: Respuesta = { configurado: false, puente: null, error: falta, conexion: dto(await conexionQr(session.organizationId)) };
    return Response.json(r);
  }
  try {
    const { puente, fila } = await sincronizar(session.organizationId, await estadoDelPuente());
    const r: Respuesta = {
      configurado: true,
      puente,
      error: puente ? null : "El puente tiene abierta la sesión de otra instancia del CRM.",
      conexion: dto(fila),
    };
    return Response.json(r);
  } catch (err) {
    const r: Respuesta = {
      configurado: true,
      puente: null,
      error: err instanceof PuenteError ? err.message : "No se pudo consultar el puente",
      conexion: dto(await conexionQr(session.organizationId)),
    };
    return Response.json(r);
  }
});

export const POST = withAuth(async (session) => {
  if (!isChannelEnabled("whatsapp_qr")) return channelDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede conectar WhatsApp");
  }
  const falta = faltaConfig();
  if (falta) return apiError(409, "no_configurado", falta);
  // La fila primero: los eventos del puente llegan en cuanto arranca la
  // sesión, y sin ella se descartarían por no ser de nadie.
  if (!(await conexionQr(session.organizationId))) {
    await guardarEstadoQr(session.organizationId, { status: "esperando_qr" });
  }
  try {
    const { puente, fila } = await sincronizar(
      session.organizationId,
      await conectarPuente(session.organizationId)
    );
    if (!puente) {
      return apiError(409, "sesion_ajena", "El puente ya tiene abierta la sesión de otra instancia del CRM");
    }
    return Response.json({ configurado: true, puente, error: null, conexion: dto(fila) } satisfies Respuesta);
  } catch (err) {
    return apiError(502, "puente", err instanceof PuenteError ? err.message : "El puente no respondió");
  }
});

export const DELETE = withAuth(async (session) => {
  if (!isChannelEnabled("whatsapp_qr")) return channelDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede desconectar WhatsApp");
  }
  try {
    await desconectarPuente();
  } catch (err) {
    // Se marca desconectado igual: el equipo pidió dejar de usar ese número.
    console.warn("[qr] el puente no confirmó la desconexión:", err instanceof Error ? err.message : err);
  }
  const fila = await guardarEstadoQr(session.organizationId, { status: "desconectado" });
  return Response.json({ configurado: true, puente: null, error: null, conexion: dto(fila) } satisfies Respuesta);
});
