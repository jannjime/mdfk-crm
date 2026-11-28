/**
 * 081 — Recordatorios de citas: lo puro (reglas, variables, cuándo toca).
 *
 * El dueño define una o varias reglas: cuánto antes de la cita y qué texto.
 * El texto admite variables: {nombre}, {fecha}, {hora}, {negocio}, {enlace}.
 * Lo usan la pantalla de Ajustes → Agenda, el proceso que envía y las pruebas.
 */
import { z } from "zod";

export type Regla = { minutosAntes: number; texto: string };

export const LIMITES = { minMinutos: 10, maxMinutos: 7 * 24 * 60, maxReglas: 4, maxTexto: 1000 } as const;

export const VARIABLES: { clave: string; ayuda: string }[] = [
  { clave: "{nombre}", ayuda: "Nombre del cliente" },
  { clave: "{fecha}", ayuda: "Día de la cita (sábado 29 de noviembre)" },
  { clave: "{hora}", ayuda: "Hora de la cita (4:00 p. m.)" },
  { clave: "{negocio}", ayuda: "Nombre de tu negocio" },
  { clave: "{enlace}", ayuda: "Enlace de la reunión, si la cita tiene uno" },
];

export const REGLAS_DE_FABRICA: Regla[] = [
  {
    minutosAntes: 120,
    texto:
      "Hola {nombre} 👋 Te recordamos tu cita del {fecha} a las {hora} en {negocio}. ¿Nos confirmas tu asistencia? Si necesitas cambiar la hora, respóndenos por aquí 🙌",
  },
];

export const reglaSchema = z.object({
  minutosAntes: z.number().int().min(LIMITES.minMinutos).max(LIMITES.maxMinutos),
  texto: z.string().trim().min(1).max(LIMITES.maxTexto),
});

export const reglasSchema = z
  .array(reglaSchema)
  .max(LIMITES.maxReglas)
  .refine((r) => new Set(r.map((x) => x.minutosAntes)).size === r.length, {
    message: "Dos recordatorios no pueden tener la misma antelación",
  });

/** «2 horas antes», «1 día antes», «30 minutos antes», «1 día y 2 horas antes». */
export function etiquetaAntelacion(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const partes: string[] = [];
  if (d) partes.push(`${d} ${d === 1 ? "día" : "días"}`);
  if (h) partes.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) partes.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  return `${partes.join(" y ") || "0 minutos"} antes`;
}

export type VariablesCita = {
  nombre: string | null;
  inicio: Date;
  zona: string;
  negocio: string | null;
  enlace: string | null;
};

/** La fecha y la hora en la zona del negocio, como se dicen en Perú. */
export function fechaYHora(inicio: Date, zona: string): { fecha: string; hora: string } {
  const fecha = new Intl.DateTimeFormat("es-PE", {
    timeZone: zona,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(inicio)
    // «martes, 1 de diciembre» → «martes 1 de diciembre», como se dice.
    .replace(",", "");
  const hora = new Intl.DateTimeFormat("es-PE", {
    timeZone: zona,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(inicio);
  return { fecha, hora };
}

/** Rellena las variables. Una que no tiene valor desaparece sin dejar huecos raros. */
export function renderRecordatorio(texto: string, v: VariablesCita): string {
  const { fecha, hora } = fechaYHora(v.inicio, v.zona);
  const primerNombre = v.nombre?.trim().split(/\s+/)[0] ?? "";
  // Un «nombre» que es solo un número de teléfono no es un nombre.
  const nombre = /^\+?\d[\d\s-]*$/.test(primerNombre) ? "" : primerNombre;
  return texto
    .replaceAll("{nombre}", nombre)
    .replaceAll("{fecha}", fecha)
    .replaceAll("{hora}", hora)
    .replaceAll("{negocio}", v.negocio?.trim() ?? "")
    .replaceAll("{enlace}", v.enlace ?? "")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type Decision = "enviar" | "esperar" | "omitir";

/**
 * ¿Toca mandar este recordatorio ahora?
 * - esperar: todavía no llega su hora.
 * - enviar: ya es su hora y la cita no empezó.
 * - omitir: la cita ya empezó, o se agendó DESPUÉS de la hora del
 *   recordatorio (agendar a las 3 para las 4 no debe disparar el de «2 horas
 *   antes» al instante: el cliente acaba de confirmar).
 */
export function decidir(r: Regla, cita: { inicio: Date; creada: Date }, ahora: Date): Decision {
  const hora = cita.inicio.getTime() - r.minutosAntes * 60_000;
  if (ahora.getTime() >= cita.inicio.getTime()) return "omitir";
  if (cita.creada.getTime() > hora) return "omitir";
  return ahora.getTime() >= hora ? "enviar" : "esperar";
}
