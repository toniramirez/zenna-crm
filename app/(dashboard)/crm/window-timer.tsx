"use client";

import { cn } from "@/lib/utils";
import {
  CLOUD_WINDOW_MS,
  formatWindowShort,
  windowLevel,
} from "@/lib/whatsapp-cloud/window";

/**
 * El cronómetro de la ventana de 24 h, tal como se ve en la lista de chats.
 *
 * Es un anillo que se vacía —queda claro de reojo cuánto falta sin leer el
 * número— más el número al lado, porque "más o menos medio anillo" no alcanza
 * para decidir si se contesta ahora o después del próximo turno. El color va
 * del verde al rojo por tramos (`windowLevel`), y cerrada se apaga a gris:
 * ahí lo accionable no es apurarse sino mandar una plantilla.
 */
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STYLES = {
  ok: "bg-[var(--wa-chip-on)] text-[var(--wa-chip-on-text)]",
  warm: "bg-[var(--wa-wait-warm-bg)] text-[var(--wa-wait-warm)]",
  urgent: "bg-[var(--wa-wait-cold-bg)] text-[var(--wa-wait-cold)]",
  closed: "border-[var(--wa-border)] text-[var(--wa-text-3)]",
} as const;

export function WindowTimer({
  leftMs,
  className,
}: {
  /** Lo que queda de ventana en ms. null / ≤0 = cerrada. */
  leftMs: number | null;
  className?: string;
}) {
  const level = windowLevel(leftMs);
  const closed = level === "closed";
  // Cerrada, `leftMs` puede ser null (nunca escribió) o negativo (cerró hace
  // rato): en los dos casos el chip dice lo mismo y el 0 nunca se muestra.
  const left = closed ? 0 : (leftMs ?? 0);
  // La fracción del anillo que sigue pintada. Se recorta arriba porque un
  // mensaje entrante recién llegado deja `leftMs` un pelo por encima de las
  // 24 h (el reloj de la bandeja late una vez por minuto).
  const fraction = closed
    ? 0
    : Math.min(1, Math.max(0, left / CLOUD_WINDOW_MS));

  const label = closed
    ? "Ventana de 24 h cerrada: solo se puede escribir con una plantilla"
    : `Ventana de 24 h: quedan ${formatWindowShort(left)} para responder sin plantilla`;

  return (
    <span
      title={label}
      className={cn(
        // El borde va en la base, transparente, para que el chip cerrado
        // (el único con borde visible) no mida un pelo más que los otros.
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums",
        STYLES[level],
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 14 14"
        className="size-3 shrink-0 -rotate-90"
        fill="none"
      >
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-25"
        />
        {fraction > 0 ? (
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        ) : null}
      </svg>
      <span className="sr-only">{label}</span>
      <span aria-hidden>
        {closed ? "Cerrada" : formatWindowShort(left)}
      </span>
    </span>
  );
}
