import { describe, expect, it } from "vitest";
import {
  decidir,
  etiquetaAntelacion,
  reglasSchema,
  renderRecordatorio,
  REGLAS_DE_FABRICA,
} from "@/lib/recordatorios";

const hora = (iso: string) => new Date(iso);

describe("081 — recordatorios de citas", () => {
  it("de fábrica: uno, 2 horas antes", () => {
    expect(REGLAS_DE_FABRICA).toHaveLength(1);
    expect(REGLAS_DE_FABRICA[0]!.minutosAntes).toBe(120);
    expect(etiquetaAntelacion(120)).toBe("2 horas antes");
    expect(etiquetaAntelacion(1440)).toBe("1 día antes");
    expect(etiquetaAntelacion(1530)).toBe("1 día y 1 hora y 30 minutos antes");
  });

  it("toca a su hora, una vez agendada antes; no si se agendó dentro de la ventana", () => {
    const r = { minutosAntes: 120, texto: "x" };
    const cita = { inicio: hora("2026-12-01T21:00:00Z"), creada: hora("2026-11-30T10:00:00Z") };
    expect(decidir(r, cita, hora("2026-12-01T18:30:00Z"))).toBe("esperar");
    expect(decidir(r, cita, hora("2026-12-01T19:00:00Z"))).toBe("enviar");
    expect(decidir(r, cita, hora("2026-12-01T20:59:00Z"))).toBe("enviar");
    expect(decidir(r, cita, hora("2026-12-01T21:00:00Z"))).toBe("omitir");
    // Agendó a las 20:00 para las 21:00: el de «2 horas antes» no sale.
    const tarde = { ...cita, creada: hora("2026-12-01T20:00:00Z") };
    expect(decidir(r, tarde, hora("2026-12-01T20:01:00Z"))).toBe("omitir");
  });

  it("variables en la zona del negocio; un teléfono no es un nombre", () => {
    const v = { nombre: "Ana Torres", inicio: hora("2026-12-01T21:00:00Z"), zona: "America/Lima", negocio: "Oxygenate", enlace: null };
    const t = renderRecordatorio("Hola {nombre}, tu sesión es el {fecha} a las {hora} en {negocio}.", v);
    expect(t).toContain("Hola Ana,");
    expect(t).toMatch(/martes 1 de diciembre/);
    expect(t).toMatch(/4:00\s?p\.?\s?m\./i);
    expect(t).toContain("Oxygenate");
    expect(renderRecordatorio("Hola {nombre} 👋", { ...v, nombre: "+51 987 654 321" })).toBe("Hola 👋");
  });

  it("valida: sin antelaciones repetidas, dentro de límites", () => {
    expect(reglasSchema.safeParse([{ minutosAntes: 120, texto: "a" }, { minutosAntes: 120, texto: "b" }]).success).toBe(false);
    expect(reglasSchema.safeParse([{ minutosAntes: 5, texto: "a" }]).success).toBe(false);
    expect(reglasSchema.safeParse([{ minutosAntes: 1440, texto: "a" }, { minutosAntes: 120, texto: "b" }]).success).toBe(true);
  });
});
