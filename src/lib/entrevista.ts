/**
 * 080 — La entrevista del negocio (la de «/personaliza» del kit de agente de
 * WhatsApp, traída al CRM).
 *
 * Nueve preguntas, una por pantalla, en lenguaje natural. Con las respuestas
 * la IA arma la plantilla completa (agente, pipeline, conocimiento,
 * respuestas rápidas) con los datos REALES del negocio: precios, enlaces y
 * nombre del agente incluidos. Lo que el dueño no dijo queda como
 * `[COMPLETAR: …]`, y el agente no lo dice.
 *
 * Puro: lo usan la pantalla, la API y las pruebas.
 */
import { z } from "zod";

export type ClavePregunta =
  | "negocio"
  | "cliente"
  | "nombreAgente"
  | "catalogo"
  | "pago"
  | "calificacion"
  | "cierre"
  | "enlaces"
  | "tono";

export type Pregunta = {
  clave: ClavePregunta;
  titulo: string;
  ayuda: string;
  ejemplo: string;
  /** Respuesta corta (un campo) o larga (un párrafo). */
  corta?: boolean;
  /** Opcional: se puede dejar en blanco. */
  opcional?: boolean;
  /** Botones de respuesta rápida (el dueño puede escribir otra cosa). */
  opciones?: string[];
};

export const PREGUNTAS: readonly Pregunta[] = [
  {
    clave: "negocio",
    titulo: "¿Cómo se llama tu negocio y qué vende?",
    ayuda: "En una o dos frases. Si tienes local, dinos el distrito o la ciudad.",
    ejemplo: "Lolita Pet — veterinaria y spa para mascotas en Surco: consultas, vacunas, baños y cortes.",
  },
  {
    clave: "cliente",
    titulo: "¿Quién te escribe por WhatsApp?",
    ayuda: "Su perfil, qué problema le resuelves y qué le frena a comprar.",
    ejemplo: "Dueños de perros y gatos de Surco y Miraflores. Quieren un lugar de confianza; les frena el precio y no saber si hay cita para hoy.",
  },
  {
    clave: "nombreAgente",
    titulo: "¿Qué nombre le ponemos a tu asistente?",
    ayuda: "Se presenta con ese nombre al saludar. Un nombre propio da cercanía.",
    ejemplo: "Lola",
    corta: true,
  },
  {
    clave: "catalogo",
    titulo: "¿Qué vendes, qué incluye y cuánto cuesta?",
    ayuda: "Los precios que pongas aquí serán los ÚNICOS que el asistente podrá decir.",
    ejemplo: "Consulta: S/ 60. Baño perro pequeño: S/ 45, mediano: S/ 60. Vacuna séxtuple: S/ 80. Corte + baño: desde S/ 70.",
  },
  {
    clave: "pago",
    titulo: "¿Cómo se paga y qué garantía o política tienes?",
    ayuda: "Medios de pago, adelantos, devoluciones, delivery…",
    ejemplo: "Yape, Plin, transferencia o efectivo. Para reservar el baño se adelanta S/ 20 por Yape. Si la mascota no queda bien, la volvemos a bañar gratis.",
  },
  {
    clave: "calificacion",
    titulo: "¿Qué debe preguntar el asistente para saber si es un buen cliente?",
    ayuda: "2 a 4 preguntas, y qué separa a un cliente bueno de uno que solo pregunta.",
    ejemplo: "¿Perro o gato y de qué tamaño? ¿Para qué día? ¿En qué distrito vive? BUENO: quiere cita esta semana. MALO: solo pregunta precios sin fecha.",
  },
  {
    clave: "cierre",
    titulo: "Cuando el cliente quiere avanzar, ¿cómo se cierra?",
    ayuda: "Elige una opción o descríbelo con tus palabras. Si es con un enlace, pégalo.",
    ejemplo: "Le paso el Yape para el adelanto y le confirmo la hora.",
    opciones: [
      "Le mando el enlace de compra o reserva",
      "Le mando un enlace para agendar una llamada",
      "Le paso el Yape/Plin y confirmo el pedido",
      "Lo paso a una persona del equipo para cerrar",
    ],
  },
  {
    clave: "enlaces",
    titulo: "¿Qué enlaces oficiales puede enviar?",
    ayuda: "Web, catálogo, reservas, Google Maps… El asistente SOLO enviará estos enlaces.",
    ejemplo: "https://lolitapet.pe · https://wa.me/c/51999999999 · https://maps.app.goo.gl/xxxx",
    opcional: true,
  },
  {
    clave: "tono",
    titulo: "¿Cómo quieres que suene?",
    ayuda: "El estilo y, si puedes, una frase que SÍ diría y una que NO diría.",
    ejemplo: "Cercano, alegre y con emojis de mascotas. SÍ: «¡Hola! 🐶 ¿Para cuándo quieres el baño de tu peludito?». NO: «Estimado cliente, le informamos…».",
    opciones: ["Cercano y directo", "Formal y elegante", "Divertido y con emojis", "Premium y exclusivo"],
  },
];

const respuesta = z.string().trim().max(2500);

export const respuestasSchema = z
  .object({
    negocio: respuesta.min(3, "Cuéntanos cómo se llama tu negocio y qué vende"),
    cliente: respuesta.min(3, "Cuéntanos quién te escribe"),
    nombreAgente: z.string().trim().min(1, "Ponle un nombre a tu asistente").max(40),
    catalogo: respuesta.min(3, "Cuéntanos qué vendes y sus precios"),
    pago: respuesta,
    calificacion: respuesta,
    cierre: respuesta,
    enlaces: respuesta,
    tono: respuesta,
  })
  .strict();

export type Respuestas = z.infer<typeof respuestasSchema>;

/** Los dominios de los enlaces que dio el dueño (sin www), para la lista de permitidos. */
export function dominiosDe(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(/\bhttps?:\/\/([^\s/?#]+)[^\s]*/gi)) {
    out.add((m[1] ?? "").toLowerCase().replace(/^www\./, ""));
  }
  for (const m of texto.matchAll(/\b((?:[a-z0-9-]+\.)+(?:pe|com|net|org|io|app|co|store|shop|la|me|link|site))\b/gi)) {
    out.add((m[1] ?? "").toLowerCase().replace(/^www\./, ""));
  }
  out.delete("");
  return [...out];
}

/** Las respuestas en un texto para la IA. Las vacías se marcan como «no lo dijo». */
export function respuestasEnTexto(r: Respuestas): string {
  return PREGUNTAS.map((p, i) => {
    const v = r[p.clave]?.trim();
    return `${i + 1}. ${p.titulo}\n${v ? v : "(el dueño no lo dijo)"}`;
  }).join("\n\n");
}
