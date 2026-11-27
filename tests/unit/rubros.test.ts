import { describe, expect, it, vi } from "vitest";
import {
  REGLA_COMPLETAR,
  RUBROS,
  conReglaCompletar,
  plantillaGenerica,
  plantillaSchema,
  rubroDe,
} from "@/lib/rubros";

vi.mock("@/lib/ai", () => ({ chatJson: vi.fn() }));
import { chatJson } from "@/lib/ai";
import { generarPlantilla, promptGenerar } from "@/server/rubros/generar";

describe("MDFK: plantillas por rubro", () => {
  it("trae los 6 rubros pedidos, con «Otros» al final y sin contenido fijo", () => {
    expect(RUBROS.map((r) => r.clave)).toEqual([
      "tienda-online",
      "comida",
      "inmobiliaria",
      "odontologia",
      "servicios",
      "otros",
    ]);
    expect(rubroDe("otros")?.plantilla).toBeNull();
    expect(rubroDe("no-existe")).toBeNull();
  });

  it.each(RUBROS.filter((r) => r.plantilla).map((r) => [r.clave, r.plantilla!] as const))(
    "%s cumple el esquema y le prohíbe al agente decir lo que falta completar",
    (_clave, p) => {
      expect(plantillaSchema.safeParse(p).success).toBe(true);
      expect(p.agente.instrucciones).toContain(REGLA_COMPLETAR);
      // los atajos no se repiten
      expect(new Set(p.respuestasRapidas.map((r) => r.atajo)).size).toBe(p.respuestasRapidas.length);
      // y las etapas tampoco
      const etapas = [...p.etapas, p.etapaGanada, p.etapaPerdida];
      expect(new Set(etapas).size).toBe(etapas.length);
    }
  );

  it("la genérica de «Otros» lleva el rubro descrito y cumple el esquema", () => {
    const p = plantillaGenerica("Gimnasio en Miraflores con clases de spinning");
    expect(plantillaSchema.safeParse(p).success).toBe(true);
    expect(p.agente.instrucciones).toContain("Gimnasio en Miraflores");
    expect(p.agente.instrucciones).toContain(REGLA_COMPLETAR);
  });

  it("si la IA olvida la regla de [COMPLETAR], se agrega", () => {
    const base = rubroDe("comida")!.plantilla!;
    const sinRegla = { ...base, agente: { ...base.agente, instrucciones: "Vende hamburguesas." } };
    const p = conReglaCompletar(sinRegla);
    expect(p.agente.instrucciones).toContain(REGLA_COMPLETAR);
    expect(plantillaSchema.safeParse(p).success).toBe(true);
  });

  it("el prompt pide soles, Perú y no inventar datos", () => {
    const { system, user } = promptGenerar("Veterinaria en Surco");
    expect(system).toContain("soles");
    expect(system).toContain("NUNCA inventes");
    expect(user).toContain("Veterinaria en Surco");
  });

  it("con la IA respondiendo bien, devuelve su plantilla", async () => {
    const ia = { ...rubroDe("servicios")!.plantilla!, etapas: ["Nuevo", "Prueba gratis", "Inscrito"] };
    vi.mocked(chatJson).mockResolvedValueOnce({ ok: true, data: ia, raw: "{}" });
    const r = await generarPlantilla("Gimnasio en Miraflores", "org_1");
    expect(r.origen).toBe("ia");
    expect(r.plantilla.etapas).toEqual(["Nuevo", "Prueba gratis", "Inscrito"]);
  });

  it("sin IA configurada no falla: cae en la genérica y dice por qué", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ ok: false, error: "not_configured", detail: "" });
    const r = await generarPlantilla("Gimnasio en Miraflores", "org_1");
    expect(r.origen).toBe("generica");
    expect(r.origen === "generica" && r.motivo).toContain("Ajustes → IA");
    expect(plantillaSchema.safeParse(r.plantilla).success).toBe(true);
  });

  it("con el proveedor fallando tampoco: genérica con otro motivo", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ ok: false, error: "provider_error", detail: "500" });
    const r = await generarPlantilla("Gimnasio en Miraflores", "org_1");
    expect(r.origen).toBe("generica");
    expect(r.origen === "generica" && r.motivo).toContain("intentarlo de nuevo");
  });
});
