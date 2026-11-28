"use client";

import { Bot, UserRound } from "lucide-react";

/**
 * 080 — «Tomar chat» en la cabecera de la conversación abierta.
 *
 * Coexistencia en un clic: la persona toma el chat (la IA se pausa sin fecha,
 * igual que el interruptor del panel con «Indefinida») y luego lo devuelve.
 * Contestar desde el teléfono hace lo mismo solo: el eco pausa la IA.
 */
export function TomarChatButton({
  aiActiva,
  onTomar,
  onDevolver,
}: {
  /** La IA contesta en esta conversación (encendida y sin traspaso). */
  aiActiva: boolean;
  onTomar: () => void;
  onDevolver: () => void;
}) {
  const label = aiActiva ? "Tomar chat: la IA deja de contestar aquí" : "Devolver el chat a la IA";
  return (
    <button
      type="button"
      data-tomar-chat
      onClick={aiActiva ? onTomar : onDevolver}
      aria-label={label}
      title={label}
      className={
        aiActiva
          ? "flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "flex shrink-0 items-center gap-1 rounded-full bg-warning-tint px-2.5 py-1.5 text-xs font-semibold text-warning-text transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      {aiActiva ? (
        <UserRound className="h-3.5 w-3.5" strokeWidth={1.8} />
      ) : (
        <Bot className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      <span className="max-sm:sr-only">{aiActiva ? "Tomar chat" : "Devolver a la IA"}</span>
    </button>
  );
}
