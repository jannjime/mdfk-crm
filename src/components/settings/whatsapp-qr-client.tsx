"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 080 — Conectar WhatsApp escaneando un QR.
 *
 * El QR lo genera el puente (que guarda la sesión). Esta pantalla lo pide,
 * lo enseña y pregunta cada pocos segundos hasta que el teléfono lo escanea;
 * WhatsApp cambia el código cada ~20 s, por eso se refresca solo.
 */

type EstadoPuente = {
  status: "desconectado" | "qr" | "conectando" | "conectado";
  qr: string | null;
  phone: string | null;
  name: string | null;
};

type Respuesta = {
  configurado: boolean;
  puente: EstadoPuente | null;
  error: string | null;
  conexion: {
    status: "desconectado" | "esperando_qr" | "conectado";
    phone: string | null;
    profileName: string | null;
    connectedAt: string | null;
  } | null;
};

const PASOS = [
  "Abre WhatsApp en el teléfono del negocio.",
  "Toca ⋮ (Android) o Configuración (iPhone) → Dispositivos vinculados → Vincular un dispositivo.",
  "Apunta la cámara a este código. En unos segundos verás «Conectado».",
];

const AVISOS = [
  "Es la misma sesión que WhatsApp Web: el teléfono puede quedarse apagado, pero si pasa ~14 días sin conectarse, WhatsApp cierra la sesión y hay que volver a escanear.",
  "Úsalo para atender a quien te escribe. Los envíos masivos a gente que no te escribió pueden hacer que WhatsApp bloquee el número; para campañas usa la API oficial.",
  "Lo que contestes desde el teléfono aparece aquí y pausa la IA en esa conversación, para que no te pise la respuesta.",
];

function formatoNumero(phone: string | null): string {
  return phone ? `+${phone}` : "tu número";
}

export function WhatsappQrClient() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [busy, setBusy] = useState<"conectar" | "desconectar" | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);
  const vivo = useRef(true);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/settings/whatsapp-qr", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Respuesta>) : null))
      .catch(() => null);
    if (vivo.current && r) setData(r);
  }, []);

  useEffect(() => {
    vivo.current = true;
    void refetch();
    return () => {
      vivo.current = false;
    };
  }, [refetch]);

  const status = data?.puente?.status ?? null;
  // Mientras se espera el escaneo, se pregunta cada 3 s; conectado, cada 30 s.
  useEffect(() => {
    if (!data) return;
    const cada = status === "qr" || status === "conectando" ? 3_000 : 30_000;
    const t = setInterval(() => void refetch(), cada);
    return () => clearInterval(t);
  }, [data, status, refetch]);

  async function accion(tipo: "conectar" | "desconectar") {
    setBusy(tipo);
    setAccionError(null);
    try {
      const res = await fetch("/api/settings/whatsapp-qr", {
        method: tipo === "conectar" ? "POST" : "DELETE",
      });
      const body = (await res.json().catch(() => null)) as
        | (Respuesta & { error?: unknown })
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        const msg =
          body && typeof body.error === "object" && body.error && "message" in body.error
            ? String(body.error.message)
            : "No se pudo completar la acción";
        setAccionError(msg);
      } else if (body && "configurado" in body) {
        setData(body);
      }
    } finally {
      setBusy(null);
      void refetch();
    }
  }

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const conectado = status === "conectado";
  const phone = data.puente?.phone ?? data.conexion?.phone ?? null;
  const name = data.puente?.name ?? data.conexion?.profileName ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      {data.error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">El puente de WhatsApp no está disponible.</p>
            <p className="text-danger-text opacity-80">{data.error}</p>
          </div>
        </div>
      )}

      {conectado && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Conectado: {formatoNumero(phone)}
              {name ? ` · ${name}` : ""}
            </p>
            <p className="text-success-text opacity-80">
              Los mensajes de este número entran a la Bandeja con el distintivo «WhatsApp (QR)».
            </p>
          </div>
          <Badge variant="success">Activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{conectado ? "Número conectado" : "Conecta tu WhatsApp con un QR"}</CardTitle>
          <CardDescription>
            Sin Meta ni verificaciones: vinculas el número como un dispositivo más,
            igual que WhatsApp Web.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!conectado && status === "qr" && data.puente?.qr && (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada por el puente */}
              <img
                src={data.puente.qr}
                alt="Código QR para vincular WhatsApp"
                className="h-60 w-60 rounded-lg border bg-white p-2"
              />
              <ol className="list-decimal space-y-2 pl-5 text-sm text-text-2">
                {PASOS.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
                <li className="list-none pt-1 text-xs opacity-80">
                  El código se renueva solo cada pocos segundos.
                </li>
              </ol>
            </div>
          )}

          {!conectado && (status === "conectando" || (status === "qr" && !data.puente?.qr)) && (
            <p className="flex items-center gap-2 text-sm text-text-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "conectando" ? "Abriendo la sesión…" : "Generando el código…"}
            </p>
          )}

          {accionError && <p className="text-sm text-destructive">{accionError}</p>}

          <div className="flex flex-wrap gap-2">
            {!conectado && status !== "qr" && status !== "conectando" && (
              <Button
                onClick={() => void accion("conectar")}
                disabled={busy !== null || !data.configurado}
              >
                {busy === "conectar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                Mostrar código QR
              </Button>
            )}
            {(conectado || status === "qr" || status === "conectando") && (
              <Button
                variant="outline"
                onClick={() => void accion("desconectar")}
                disabled={busy !== null}
              >
                {busy === "desconectar" && <Loader2 className="h-4 w-4 animate-spin" />}
                {conectado ? "Desconectar este número" : "Cancelar"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Antes de usarlo</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-2">
            {AVISOS.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs text-text-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          La sesión vive en el puente, dentro de tu servidor; el CRM nunca la guarda.
          Desconectar aquí cierra la sesión también en el teléfono.
        </span>
      </p>
    </div>
  );
}
