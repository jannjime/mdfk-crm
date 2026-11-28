"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PREGUNTAS, type Respuestas } from "@/lib/entrevista";
import type { Plantilla } from "@/lib/rubros";

/**
 * 080 — «Cuéntame de tu negocio»: la entrevista del kit, una pregunta por
 * pantalla. Al final la IA arma el asistente con los datos reales, el dueño
 * lo revisa y lo guarda de un clic. Las respuestas se recuerdan en este
 * navegador mientras tanto (si se cierra la pestaña, no se pierden).
 */

const BORRADOR = "mdfk.entrevista.v1";
const VACIAS: Respuestas = {
  negocio: "",
  cliente: "",
  nombreAgente: "",
  catalogo: "",
  pago: "",
  calificacion: "",
  cierre: "",
  enlaces: "",
  tono: "",
};

function leerBorrador(): Respuestas {
  try {
    const raw = window.localStorage.getItem(BORRADOR);
    return raw ? { ...VACIAS, ...(JSON.parse(raw) as Partial<Respuestas>) } : VACIAS;
  } catch {
    return VACIAS;
  }
}

function guardarBorrador(r: Respuestas) {
  try {
    window.localStorage.setItem(BORRADOR, JSON.stringify(r));
  } catch {
    // sin almacenamiento: la entrevista funciona igual, solo no se recuerda
  }
}

export function EntrevistaClient() {
  const router = useRouter();
  const [paso, setPaso] = useState(0);
  const [r, setR] = useState<Respuestas>(VACIAS);
  const [fase, setFase] = useState<"preguntas" | "generando" | "revisar" | "guardando" | "listo">("preguntas");
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setR(leerBorrador()), []);

  const p = PREGUNTAS[paso]!;
  const valor = r[p.clave] ?? "";
  const puedeSeguir = p.opcional || valor.trim().length > 0;
  const total = PREGUNTAS.length;

  function cambiar(v: string) {
    const nuevo = { ...r, [p.clave]: v };
    setR(nuevo);
    guardarBorrador(nuevo);
  }

  async function generar() {
    setFase("generando");
    setError(null);
    const res = await fetch("/api/agent/entrevista", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ respuestas: r }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { plantilla?: Plantilla; error?: { message?: string } }
      | null;
    if (!res?.ok || !data?.plantilla) {
      setError(data?.error?.message ?? "No se pudo armar el asistente. Inténtalo de nuevo.");
      setFase("preguntas");
      return;
    }
    setPlantilla(data.plantilla);
    setFase("revisar");
  }

  async function guardar() {
    if (!plantilla) return;
    setFase("guardando");
    setError(null);
    const res = await fetch("/api/agent/rubro", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plantilla }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo guardar.");
      setFase("revisar");
      return;
    }
    try {
      window.localStorage.removeItem(BORRADOR);
    } catch {
      // ignorar
    }
    setFase("listo");
  }

  const pendientes = useMemo(
    () =>
      plantilla
        ? plantilla.conocimiento.filter((c) => c.respuesta.includes("[COMPLETAR")).length
        : 0,
    [plantilla]
  );

  if (fase === "listo") {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-4 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <h2 className="text-lg font-bold">¡{plantilla?.agente.nombre} está listo!</h2>
          <p className="text-sm text-text-2">
            Guardé su forma de hablar, sus instrucciones, tu pipeline, las preguntas frecuentes y
            respuestas rápidas.
            {pendientes > 0 &&
              ` Quedan ${pendientes} datos marcados [COMPLETAR] en el conocimiento: mientras tengan esa marca, no los dice.`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => router.push("/agent")}>Ver y ajustar el agente</Button>
            <Button variant="outline" onClick={() => router.push("/lab")}>
              Probarlo en el Laboratorio
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if ((fase === "revisar" || fase === "guardando") && plantilla) {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Así quedó tu asistente</CardTitle>
          <CardDescription>Revísalo. Todo se puede ajustar después en Agente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-md border p-3">
            <p className="font-semibold">
              {plantilla.agente.nombre} <span className="font-normal text-text-3">· {plantilla.agente.tono}</span>
            </p>
            <p className="mt-2 text-text-2">«{plantilla.agente.saludo}»</p>
          </div>
          <div>
            <p className="font-medium">Cómo atiende</p>
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-line rounded-md bg-subtle p-3 text-xs text-text-2">
              {plantilla.agente.instrucciones}
            </p>
          </div>
          <div>
            <p className="font-medium">Tu pipeline</p>
            <p className="text-text-2">
              {[...plantilla.etapas, plantilla.etapaGanada, plantilla.etapaPerdida].join(" → ")}
            </p>
          </div>
          <div>
            <p className="font-medium">Preguntas frecuentes ({plantilla.conocimiento.length})</p>
            <ul className="mt-1 max-h-56 space-y-2 overflow-y-auto">
              {plantilla.conocimiento.map((c, i) => (
                <li key={i} className="rounded-md border p-2 text-xs">
                  <p className="font-medium">{c.pregunta}</p>
                  <p className="text-text-2">{c.respuesta}</p>
                </li>
              ))}
            </ul>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void guardar()} disabled={fase === "guardando"}>
              {fase === "guardando" && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar mi asistente
            </Button>
            <Button variant="outline" onClick={() => setFase("preguntas")} disabled={fase === "guardando"}>
              Corregir respuestas
            </Button>
          </div>
          <p className="text-xs text-text-3">
            Reemplaza el nombre, tono, instrucciones y saludo del agente. Las etapas solo cambian si
            todavía no tienen leads; las preguntas y respuestas rápidas se agregan.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (fase === "generando") {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-3 p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 animate-pulse text-primary" />
          <p className="font-semibold">Armando a {r.nombreAgente || "tu asistente"}…</p>
          <p className="text-sm text-text-2">
            Escribo sus instrucciones, tu pipeline y las preguntas frecuentes con tus datos. Tarda
            hasta un minuto.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <p className="kicker text-text-3">
          Pregunta {paso + 1} de {total}
        </p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((paso + 1) / total) * 100}%` }}
          />
        </div>
        <CardTitle className="pt-2 text-xl">{p.titulo}</CardTitle>
        <CardDescription>{p.ayuda}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {p.opciones && (
          <div className="flex flex-wrap gap-2">
            {p.opciones.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => cambiar(valor.trim() ? `${o}. ${valor}` : o)}
                className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
              >
                {o}
              </button>
            ))}
          </div>
        )}
        {p.corta ? (
          <Input
            autoFocus
            value={valor}
            maxLength={40}
            onChange={(e) => cambiar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && puedeSeguir) setPaso((x) => Math.min(x + 1, total - 1));
            }}
            placeholder={`Ej.: ${p.ejemplo}`}
          />
        ) : (
          <Textarea
            autoFocus
            rows={4}
            maxLength={2500}
            value={valor}
            onChange={(e) => cambiar(e.target.value)}
            placeholder={`Ej.: ${p.ejemplo}`}
          />
        )}
        <p className="text-xs text-text-3">Responde como le hablarías a una persona: yo lo ordeno.</p>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}{" "}
            {error.includes("Ajustes → IA") && (
              <Link href="/settings/ai" className="font-semibold underline">
                Ir a Ajustes → IA
              </Link>
            )}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => setPaso((x) => Math.max(x - 1, 0))} disabled={paso === 0}>
            <ArrowLeft className="h-4 w-4" /> Atrás
          </Button>
          {paso < total - 1 ? (
            <Button onClick={() => setPaso((x) => x + 1)} disabled={!puedeSeguir}>
              {p.opcional && !valor.trim() ? "Saltar" : "Siguiente"} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => void generar()} disabled={!puedeSeguir}>
              <Sparkles className="h-4 w-4" /> Crear mi asistente
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
