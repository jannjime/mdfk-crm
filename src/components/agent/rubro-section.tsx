"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RUBROS, type ClaveRubro, type Plantilla } from "@/lib/rubros";

/**
 * MDFK — Plantillas por rubro: el CRM listo para un tipo de negocio de un
 * clic. «Otros» la genera la IA con lo que el dueño describe.
 */
export function RubroSection({ onAplicada }: { onAplicada: () => void }) {
  const [elegido, setElegido] = useState<ClaveRubro | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [generada, setGenerada] = useState<Plantilla | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"generando" | "aplicando" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const rubro = RUBROS.find((r) => r.clave === elegido) ?? null;
  const vista: Plantilla | null = rubro?.plantilla ?? (elegido === "otros" ? generada : null);

  function elegir(clave: ClaveRubro) {
    setElegido(clave);
    setError(null);
    setHecho(null);
    if (clave !== "otros") setAviso(null);
  }

  async function generar() {
    setOcupado("generando");
    setError(null);
    setAviso(null);
    setGenerada(null);
    const res = await fetch("/api/agent/rubro/generar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ descripcion }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { origen: "ia" | "generica"; plantilla: Plantilla; motivo?: string; error?: { message?: string } }
      | null;
    setOcupado(null);
    if (!res?.ok || !data?.plantilla) {
      setError(data?.error?.message ?? "No se pudo generar la plantilla. Intenta de nuevo.");
      return;
    }
    setGenerada(data.plantilla);
    if (data.origen === "generica" && data.motivo) setAviso(data.motivo);
  }

  async function aplicar() {
    if (!vista) return;
    const ok = window.confirm(
      "Aplicar la plantilla reemplaza el nombre, el tono, las instrucciones, el saludo y las reglas de escalado del agente. " +
        "Las etapas del pipeline se cambian solo si todavía no tienen leads. El conocimiento y las respuestas rápidas se agregan sin borrar lo que ya tienes. ¿Continuar?"
    );
    if (!ok) return;
    setOcupado("aplicando");
    setError(null);
    const body = elegido === "otros" ? { plantilla: vista } : { rubro: elegido };
    const res = await fetch("/api/agent/rubro", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | {
          etapas?: "reemplazadas" | "conservadas";
          conocimientoAgregado?: number;
          respuestasAgregadas?: number;
          error?: { message?: string };
        }
      | null;
    setOcupado(null);
    if (!res?.ok || !data) {
      setError(data?.error?.message ?? "No se pudo aplicar la plantilla.");
      return;
    }
    setHecho(
      [
        "Plantilla aplicada ✓",
        data.etapas === "reemplazadas"
          ? "Etapas del pipeline actualizadas."
          : "Las etapas se conservaron porque ya tienen leads.",
        `${data.conocimientoAgregado ?? 0} preguntas agregadas al conocimiento y ${data.respuestasAgregadas ?? 0} respuestas rápidas.`,
        "Completa los datos marcados [COMPLETAR] en el conocimiento: mientras tengan esa marca, el agente no los dice.",
      ].join(" ")
    );
    onAplicada();
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Plantilla por rubro</CardTitle>
        <CardDescription>
          Elige tu tipo de negocio y deja listo el agente, el pipeline, las preguntas frecuentes y las
          respuestas rápidas de un clic. Luego solo completas tus precios y datos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Rubro">
          {RUBROS.map((r) => (
            <li key={r.clave}>
              <button
                type="button"
                role="radio"
                aria-checked={elegido === r.clave}
                onClick={() => elegir(r.clave)}
                className={
                  "flex h-full w-full items-start gap-3 rounded-md border p-3 text-left transition-colors " +
                  (elegido === r.clave
                    ? "border-primary bg-brand-tint"
                    : "hover:bg-accent")
                }
              >
                <span className="text-2xl leading-none" aria-hidden>
                  {r.emoji}
                </span>
                <span>
                  <span className="block text-sm font-medium">{r.etiqueta}</span>
                  <span className="block text-xs text-muted-foreground">{r.descripcion}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {elegido === "otros" && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="rubro-descripcion">Describe tu negocio</Label>
            <Textarea
              id="rubro-descripcion"
              rows={3}
              maxLength={1500}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej.: Gimnasio en Miraflores con clases de funcional y spinning, membresías mensuales y trimestrales, y una semana de prueba gratis."
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void generar()}
                disabled={ocupado !== null || descripcion.trim().length < 10}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {ocupado === "generando" ? "Generando…" : generada ? "Generar de nuevo" : "Generar con IA"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Usa la IA de Ajustes → IA. Tarda unos segundos.
              </span>
            </div>
          </div>
        )}

        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}

        {vista && (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              <span className="font-medium">Agente:</span> {vista.agente.nombre} —{" "}
              <span className="text-muted-foreground">{vista.agente.tono}</span>
            </p>
            <div>
              <p className="font-medium">Pipeline</p>
              <p className="text-muted-foreground">
                {[...vista.etapas, vista.etapaGanada, vista.etapaPerdida].join(" → ")}
              </p>
            </div>
            <div>
              <p className="font-medium">Preguntas frecuentes ({vista.conocimiento.length})</p>
              <p className="text-muted-foreground">
                {vista.conocimiento.map((c) => c.pregunta).join(" · ")}
              </p>
            </div>
            {vista.respuestasRapidas.length > 0 && (
              <div>
                <p className="font-medium">Respuestas rápidas</p>
                <p className="text-muted-foreground">
                  {vista.respuestasRapidas.map((r) => `/${r.atajo}`).join("  ")}
                </p>
              </div>
            )}
            <Button size="sm" onClick={() => void aplicar()} disabled={ocupado !== null}>
              {ocupado === "aplicando" ? "Aplicando…" : "Aplicar plantilla"}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        )}
        {hecho && (
          <p role="status" className="text-xs text-primary">
            {hecho}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
