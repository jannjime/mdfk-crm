import { EntrevistaClient } from "@/components/agent/entrevista-client";

export const dynamic = "force-dynamic";

/** 080 — «Cuéntame de tu negocio»: la entrevista que arma al asistente. */
export default function EntrevistaPage() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto mb-6 max-w-2xl text-center">
        <h1 className="text-2xl font-bold tracking-tight">Cuéntame de tu negocio</h1>
        <p className="mt-1 text-sm text-text-2">
          9 preguntas, unos 3 minutos. Con tus respuestas armo a tu asistente: cómo saluda, qué
          vende, a qué precio y cómo cierra.
        </p>
      </div>
      <EntrevistaClient />
    </div>
  );
}
