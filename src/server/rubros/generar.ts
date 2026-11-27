import { chatJson } from "@/lib/ai";
import {
  REGLA_COMPLETAR,
  RUBROS,
  conReglaCompletar,
  plantillaGenerica,
  plantillaSchema,
  type Plantilla,
} from "@/lib/rubros";

/**
 * MDFK — «Otros»: la IA arma la plantilla a partir de lo que el dueño
 * describe de su negocio, con el MISMO esquema que las plantillas fijas.
 *
 * Nunca tumba la pantalla: sin IA configurada o con un proveedor que falla,
 * devuelve la plantilla genérica y dice por qué (`origen: "generica"`).
 */
export type ResultadoGenerar =
  | { origen: "ia"; plantilla: Plantilla }
  | { origen: "generica"; plantilla: Plantilla; motivo: string };

const EJEMPLO = RUBROS.find((r) => r.clave === "odontologia")!.plantilla!;

export function promptGenerar(descripcion: string): { system: string; user: string } {
  const system = [
    "Eres un consultor experto en ventas por WhatsApp para negocios en Perú.",
    "Diseñas la configuración inicial de un CRM con agente de IA para UN negocio.",
    "Respondes ÚNICAMENTE un objeto JSON con este esquema (mismas claves):",
    `{"agente":{"nombre","tono","instrucciones","reglasDeEscalado","saludo"},"etapas":[string],"etapaGanada","etapaPerdida","conocimiento":[{"pregunta","respuesta"}],"respuestasRapidas":[{"atajo","texto"}]}`,
    "Reglas:",
    "- Español de Perú, natural y comercial. Moneda: soles (S/). Pagos típicos: Yape, Plin, transferencia, efectivo.",
    "- instrucciones: pasos numerados de cómo atiende y califica el agente para ESE rubro, y qué datos pide para cerrar. Máx. 2500 caracteres.",
    `- Termina las instrucciones con esta regla, literal: ${REGLA_COMPLETAR}`,
    "- reglasDeEscalado: cuándo pasar a una persona (reclamos, temas delicados del rubro, hostilidad, si lo pide).",
    "- etapas: de 3 a 6 etapas ABIERTAS del embudo propio del rubro, en orden, cortas (máx. 30 caracteres). etapaGanada y etapaPerdida aparte.",
    "- conocimiento: de 6 a 10 preguntas frecuentes del rubro. Cualquier dato que solo el dueño sabe (precios, dirección, horario, stock, números) va como [COMPLETAR: qué dato falta]. NUNCA inventes precios ni datos concretos.",
    "- respuestasRapidas: de 3 a 5. atajo en minúsculas sin espacios ni tildes (a-z, 0-9, - o _). Puedes usar {nombre} para el nombre del cliente y [COMPLETAR: …] para datos faltantes.",
    "- saludo: corto, con [COMPLETAR: nombre del negocio].",
    "Ejemplo de una plantilla bien hecha (centro odontológico):",
    JSON.stringify(EJEMPLO),
  ].join("\n");
  const user = `Mi negocio: ${descripcion.trim().slice(0, 1500)}`;
  return { system, user };
}

export async function generarPlantilla(
  descripcion: string,
  organizationId: string
): Promise<ResultadoGenerar> {
  const { system, user } = promptGenerar(descripcion);
  const r = await chatJson(
    plantillaSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId, timeoutMs: 90_000 }
  );
  if (r.ok) return { origen: "ia", plantilla: conReglaCompletar(r.data) };
  const motivo =
    r.error === "not_configured"
      ? "No hay IA configurada (Ajustes → IA). Cargamos una plantilla general que puedes ajustar."
      : "La IA no respondió bien esta vez. Cargamos una plantilla general; puedes intentarlo de nuevo.";
  return { origen: "generica", plantilla: plantillaGenerica(descripcion), motivo };
}
