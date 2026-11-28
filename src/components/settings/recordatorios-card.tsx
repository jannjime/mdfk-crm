"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  etiquetaAntelacion,
  LIMITES,
  renderRecordatorio,
  VARIABLES,
  type Regla,
} from "@/lib/recordatorios";

/**
 * 081 — Ajustes → Agenda → Recordatorios: cuánto antes y qué texto. Cada
 * regla muestra cómo le llegaría al cliente, con una cita de ejemplo.
 */

const ANTELACIONES: { min: number; etiqueta: string }[] = [
  { min: 30, etiqueta: "30 min" },
  { min: 60, etiqueta: "1 hora" },
  { min: 120, etiqueta: "2 horas" },
  { min: 180, etiqueta: "3 horas" },
  { min: 360, etiqueta: "6 horas" },
  { min: 1440, etiqueta: "1 día" },
  { min: 2880, etiqueta: "2 días" },
];

const TEXTO_NUEVO = "Hola {nombre} 😊 Te esperamos el {fecha} a las {hora} en {negocio}. ¿Nos confirmas?";

export function RecordatoriosCard({ zona }: { zona: string }) {
  const [enabled, setEnabled] = useState(true);
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void fetch("/api/calendar/reminders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled: boolean; reglas: Regla[] } | null) => {
        if (!d) return;
        setEnabled(d.enabled);
        setReglas(d.reglas);
      })
      .catch(() => null);
  }, []);

  const ejemplo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(16, 0, 0, 0);
    return d;
  }, []);

  function cambiar(i: number, parcial: Partial<Regla>) {
    setReglas((rs) => rs!.map((r, j) => (j === i ? { ...r, ...parcial } : r)));
    setEstado(null);
  }

  async function guardar() {
    if (!reglas) return;
    setGuardando(true);
    setEstado(null);
    const res = await fetch("/api/calendar/reminders", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, reglas }),
    }).catch(() => null);
    setGuardando(false);
    if (res?.ok) {
      const d = (await res.json()) as { reglas: Regla[] };
      setReglas(d.reglas);
      setEstado("Guardado ✓");
    } else {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setEstado(d?.error?.message ?? "No se pudo guardar");
    }
  }

  if (!reglas) return null;
  const usadas = new Set(reglas.map((r) => r.minutosAntes));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Recordatorios de citas
            </CardTitle>
            <CardDescription>
              Se mandan solos por el mismo chat del cliente (WhatsApp, Instagram…), una sola vez por cita.
            </CardDescription>
          </div>
          <Switch
            size="sm"
            checked={enabled}
            label="Recordatorios activos"
            onCheckedChange={(v) => {
              setEnabled(v);
              setEstado(null);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className={enabled ? "space-y-4" : "space-y-4 opacity-60"}>
        {reglas.map((r, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {ANTELACIONES.map((a) => (
                <button
                  key={a.min}
                  type="button"
                  disabled={a.min !== r.minutosAntes && usadas.has(a.min)}
                  onClick={() => cambiar(i, { minutosAntes: a.min })}
                  className={
                    "rounded-full border px-2.5 py-1 text-xs disabled:opacity-40 " +
                    (a.min === r.minutosAntes ? "border-primary bg-brand-tint font-semibold" : "hover:bg-accent")
                  }
                >
                  {a.etiqueta}
                </button>
              ))}
              <span className="ml-auto text-xs text-text-3">{etiquetaAntelacion(r.minutosAntes)}</span>
              {reglas.length > 1 && (
                <button
                  type="button"
                  aria-label="Quitar este recordatorio"
                  onClick={() => setReglas((rs) => rs!.filter((_, j) => j !== i))}
                  className="rounded p-1 text-text-3 hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <Textarea
              rows={3}
              maxLength={LIMITES.maxTexto}
              value={r.texto}
              onChange={(e) => cambiar(i, { texto: e.target.value })}
            />
            <p className="rounded-md bg-subtle p-2 text-xs text-text-2">
              <span className="font-medium">Así le llega:</span>{" "}
              {renderRecordatorio(r.texto, {
                nombre: "Ana Torres",
                inicio: ejemplo,
                zona,
                negocio: "tu negocio",
                enlace: null,
              })}
            </p>
          </div>
        ))}

        <p className="text-xs text-text-3">
          Variables: {VARIABLES.map((v) => (
            <span key={v.clave} title={v.ayuda} className="mr-2 font-mono">
              {v.clave}
            </span>
          ))}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {reglas.length < LIMITES.maxReglas && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const libre = ANTELACIONES.find((a) => !usadas.has(a.min))?.min ?? 1440;
                setReglas((rs) => [...rs!, { minutosAntes: libre, texto: TEXTO_NUEVO }]);
              }}
            >
              <Plus className="h-4 w-4" /> Agregar otro recordatorio
            </Button>
          )}
          <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar recordatorios"}
          </Button>
          {estado && <span className="text-xs text-text-2">{estado}</span>}
        </div>
        <p className="text-xs text-text-3">
          En WhatsApp por QR salen siempre. Con la API oficial de WhatsApp solo salen si el cliente
          escribió en las últimas 24 horas (regla de Meta).
        </p>
      </CardContent>
    </Card>
  );
}
