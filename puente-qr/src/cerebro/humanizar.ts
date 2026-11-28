/**
 * La humanización del kit: que la respuesta suene a una persona escribiendo
 * por WhatsApp (sin símbolos de bot) y se parta en varios mensajes cortos
 * cuando el modelo lo marca con `|||`.
 *
 * Diferencia con el kit: los emojis se respetan (el tono del negocio decide;
 * muchos negocios en Perú los usan), y el formato *negrita* de WhatsApp de un
 * solo asterisco se deja, porque WhatsApp sí lo dibuja.
 */

export const SEPARADOR = "|||";
const MAX_MENSAJES = 4;

export function saneaHumano(text: string): string {
  let t = text;
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/\s*[→←]\s*/g, " ");
  t = t.replace(/[·•`]/g, "");
  // Markdown de doble asterisco → negrita de WhatsApp (un asterisco).
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  t = t.replace(/^\s*#{1,6}\s*/gm, "");
  t = t.replace(/^\s*[-•]\s+/gm, "");
  t = t.replace(/[“”„‟«»]/g, '"').replace(/[‘’‚‛]/g, "'");
  t = t.replace(/…/g, "...");
  t = t.replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function dividirMensajes(text: string): string[] {
  const partes = text
    .split(SEPARADOR)
    .map((p) => saneaHumano(p))
    .filter((p) => p.length > 0);
  if (partes.length <= MAX_MENSAJES) return partes;
  return [...partes.slice(0, MAX_MENSAJES - 1), partes.slice(MAX_MENSAJES - 1).join("\n")];
}

/** Pausa entre mensajes, como quien escribe: proporcional al largo, con tope. */
export function pausaEscritura(mensaje: string): number {
  return Math.min(700 + mensaje.length * 25, 3_000);
}
