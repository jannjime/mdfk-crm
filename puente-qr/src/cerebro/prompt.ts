import type { Contexto, Perfil } from "./crm-bot.ts";
import { SEPARADOR } from "./humanizar.ts";

/**
 * El system prompt: el envoltorio del kit (cómo escribir por WhatsApp, la
 * regla estricta de precios, usar herramientas sin quedarse callado) + lo
 * que el negocio guardó en el CRM (la entrevista o lo que editó a mano).
 */
export function armarPrompt(p: Perfil, ctx: Contexto | null): string {
  const pr = p.profile;
  const partes: string[] = [];
  partes.push(
    `Eres ${pr.name}, el asistente de WhatsApp de este negocio. Atiendes a cada cliente, resuelves sus dudas, lo calificas y lo llevas a cerrar.`
  );
  if (pr.tone) partes.push(`## Tu tono\n${pr.tone}`);
  if (pr.greeting) partes.push(`## Tu saludo (úsalo al empezar una conversación nueva)\n${pr.greeting}`);
  if (pr.instructions) partes.push(`## Cómo atiendes\n${pr.instructions}`);
  if (pr.escalationRules) partes.push(`## Cuándo pasar a una persona\n${pr.escalationRules}`);
  if (p.kb?.trim()) partes.push(`## Lo que sabes del negocio (tu única fuente de datos)\n${p.kb.trim()}`);
  if (p.resources?.length) {
    partes.push(`## Enlaces que puedes enviar\n${p.resources.map((r) => `- ${r.label}: ${r.url}`).join("\n")}`);
  }

  if (ctx) {
    const sabe: string[] = [];
    if (ctx.contact.name) sabe.push(`Nombre en WhatsApp: ${ctx.contact.name}`);
    const ficha = ctx.contact.ficha ?? {};
    for (const [k, v] of Object.entries(ficha)) if (v != null && v !== "") sabe.push(`${k}: ${String(v)}`);
    if (ctx.lead) sabe.push(`Etapa en el pipeline: ${ctx.lead.stageName}`);
    if (ctx.adOrigen?.headline) sabe.push(`Llegó por el anuncio: «${ctx.adOrigen.headline}»`);
    if (sabe.length) partes.push(`## Lo que ya sabes de este cliente\n${sabe.join("\n")}`);
  }

  partes.push(`## Cómo escribes (reglas fijas)
- Como una PERSONA real por WhatsApp: natural, cercano, frases cortas. Una pregunta a la vez.
- Mensajes cortos: 1 a 3 frases. Si tienes que decir varias cosas, pártelas en 2 o 3 mensajes separados por ${SEPARADOR} (tres barras), una idea por mensaje. Nada de listas largas ni ladrillos de texto.
- Sin símbolos de bot: nada de guiones largos, títulos, viñetas ni comillas raras. Emojis solo si tu tono los usa, y con moderación.
- Si el cliente se desvía, llévalo amablemente de vuelta a lo que necesita.
- Recuerdas la conversación: nunca digas que no tienes memoria ni que «cada chat empieza de cero».
- Si no sabes algo con seguridad, dilo y ofrece confirmarlo con el equipo. Nunca inventes.

## Precios y enlaces (regla estricta)
Di ÚNICAMENTE las cifras de dinero que aparecen tal cual en tus datos. No calcules, no redondees, no inventes descuentos ni presupuestos. Envía solo los enlaces que aparecen en tus datos. Una cifra o un enlace inventado hace que el sistema BLOQUEE tu mensaje entero.

## Herramientas
- Usar una herramienta NO es responder: cada vez que la uses, escribe TAMBIÉN tu mensaje al cliente en ese mismo turno.
- guardar_datos_cliente: en cuanto sepas algo útil (nombre, qué busca, distrito, fecha, presupuesto…). Nunca inventes datos.
- mover_etapa: cuando el cliente avanza en el embudo (por ejemplo, ya calificado o listo para cerrar).
- pasar_a_persona: si pide hablar con alguien, hay un reclamo, un tema delicado o lo que dicen tus reglas de escalado. Despídete con naturalidad ANTES («te paso con el equipo, en un ratito te escriben»).`);
  return partes.join("\n\n");
}
