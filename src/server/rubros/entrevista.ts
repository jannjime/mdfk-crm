import { chatJson } from "@/lib/ai";
import { RUBROS, REGLA_COMPLETAR, conReglaCompletar, plantillaSchema, type Plantilla } from "@/lib/rubros";
import { respuestasEnTexto, type Respuestas } from "@/lib/entrevista";

/**
 * 080 — La plantilla a partir de la entrevista (9 preguntas del kit).
 *
 * A diferencia de «Otros» (una descripción suelta), aquí el dueño dio sus
 * datos: la IA los usa TAL CUAL —precios, enlaces, nombre del agente— y solo
 * marca `[COMPLETAR: …]` lo que no dijo. Nunca tumba la pantalla: sin IA o
 * con un proveedor que falla, dice por qué y no aplica nada.
 */
export type ResultadoEntrevista =
  | { ok: true; plantilla: Plantilla }
  | { ok: false; motivo: string };

const EJEMPLO = RUBROS.find((r) => r.clave === "odontologia")!.plantilla!;

export function promptEntrevista(r: Respuestas): { system: string; user: string } {
  const system = [
    "Eres un consultor experto en ventas por WhatsApp para negocios en Perú.",
    "Con la entrevista que respondió el dueño, configuras su CRM con agente de IA.",
    "Respondes ÚNICAMENTE un objeto JSON con este esquema (mismas claves):",
    `{"agente":{"nombre","tono","instrucciones","reglasDeEscalado","saludo"},"etapas":[string],"etapaGanada","etapaPerdida","conocimiento":[{"pregunta","respuesta"}],"respuestasRapidas":[{"atajo","texto"}]}`,
    "Reglas:",
    "- USA LOS DATOS REALES del dueño: su nombre de negocio, precios EXACTOS (mismas cifras y moneda), medios de pago, enlaces y el nombre del agente (agente.nombre = la respuesta 3). No cambies ni redondees cifras.",
    "- Nunca inventes precios, direcciones, horarios ni enlaces. Lo que el dueño no dijo va como [COMPLETAR: qué dato falta].",
    "- Español de Perú, natural y comercial. Si el dueño no da moneda, usa soles (S/).",
    "- agente.tono: describe el estilo de la respuesta 9 e incluye sus frases de SÍ y NO si las dio.",
    "- agente.instrucciones (máx. 3000 caracteres), en pasos numerados: 1) saludar y presentarse con su nombre; 2) entender qué necesita; 3) calificar con las preguntas de la respuesta 6, de a una, y distinguir cliente bueno/malo con esas señales; 4) ofrecer lo del catálogo con sus precios exactos; 5) cerrar como dijo en la respuesta 7 (con su enlace si lo dio); 6) qué datos pedir para dejarlo listo. Solo puede enviar los enlaces de la respuesta 8 (y el de la 7). Mensajes cortos, como en WhatsApp.",
    `- Termina las instrucciones con esta regla, literal: ${REGLA_COMPLETAR}`,
    "- reglasDeEscalado: cuándo pasar a una persona (reclamos, temas delicados del rubro, hostilidad, si lo pide, y si el cierre de la respuesta 7 es «pasarlo a una persona», al momento de cerrar).",
    "- etapas: de 3 a 6 etapas ABIERTAS del embudo propio del negocio, en orden, cortas (máx. 30 caracteres). etapaGanada y etapaPerdida aparte.",
    "- conocimiento: de 6 a 12 preguntas frecuentes con respuestas usando los datos reales (catálogo, precios, pago, garantía, cierre, enlaces) y 2-3 objeciones típicas del cliente de la respuesta 2 con cómo contestarlas.",
    "- respuestasRapidas: de 3 a 5. atajo en minúsculas sin espacios ni tildes (a-z, 0-9, - o _). Puedes usar {nombre} para el nombre del cliente.",
    "- saludo: corto, con el nombre del agente y del negocio.",
    "Ejemplo del formato (otro negocio, NO copies sus datos):",
    JSON.stringify(EJEMPLO),
  ].join("\n");
  return { system, user: `Entrevista del dueño:\n\n${respuestasEnTexto(r)}` };
}

export async function generarDesdeEntrevista(
  r: Respuestas,
  organizationId: string
): Promise<ResultadoEntrevista> {
  const { system, user } = promptEntrevista(r);
  const res = await chatJson(
    plantillaSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId, timeoutMs: 120_000 }
  );
  if (res.ok) {
    const p = conReglaCompletar(res.data);
    // El nombre que eligió el dueño manda, diga lo que diga el modelo.
    return { ok: true, plantilla: { ...p, agente: { ...p.agente, nombre: r.nombreAgente.trim().slice(0, 60) } } };
  }
  return {
    ok: false,
    motivo:
      res.error === "not_configured"
        ? "Primero conecta tu IA en Ajustes → IA (proveedor, modelo y llave). Con eso armo tu asistente."
        : "La IA no respondió bien esta vez. Tus respuestas siguen aquí: inténtalo de nuevo.",
  };
}
