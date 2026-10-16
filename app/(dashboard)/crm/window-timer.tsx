"use client";

import { cn } from "@/lib/utils";
import {
  CLOUD_WINDOW_MS,
  formatWindowShort,
  windowLevel,
} from "@/lib/whatsapp-cloud/window";

/**
 * El cronómetro de la ventana de 24 h, tal como se ve en la lista de chats:
 * ocupa el círculo del avatar, que en la Cloud API quedó vacío porque Meta no
 * comparte la foto de perfil.
 *
 * El borde es un anillo que se vacía —queda claro de reojo cuánto falta sin
 * leer el número— y adentro va el número, porque "más o menos medio anillo" no
 * alcanza para decidir si se contesta ahora o después del próximo turno. El
 * color va del verde al rojo por tramos (`windowLevel`). Cerrada no se dibuja:
 * el avatar vuelve a ser el de siempre y lo accionable pasa a ser mandar una
 * plantilla, que se ofrece adentro del chat.
 */
const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STYLES = {
  ok: "bg-[var(--wa-chip-on)] text-[var(--wa-chip-on-text)]",
  warm: "bg-[var(--wa-wait-warm-bg)] text-[var(--wa-wait-warm)]",
  urgent: "bg-[var(--wa-wait-cold-bg)] text-[var(--wa-wait-cold)]",
} as const;

export function windowTimerLabel(leftMs: number | null): string {
  return windowLevel(leftMs) === "closed"
    ? "Ventana de 24 h cerrada: solo se puede escribir con una plantilla"
    : `Ventana de 24 h: quedan ${formatWindowShort(leftMs ?? 0)} para responder sin plantilla`;
}

export function WindowTimer({
  leftMs,
  size,
  className,
}: {
  /** Lo que queda de ventana en ms. Tiene que estar abierta (> 0). */
  leftMs: number;
  size: number;
  className?: string;
}) {
  const level = windowLevel(leftMs);
  if (level === "closed") return null;

  // La fracción del anillo que sigue pintada. Se recorta arriba porque un
  // mensaje entrante recién llegado deja `leftMs` un pelo por encima de las
  // 24 h (el reloj de la bandeja late una vez por minuto).
  const fraction = Math.min(1, Math.max(0, leftMs / CLOUD_WINDOW_MS));
  // "8 h" / "45 min" / "<1 min": el número arriba y la unidad abajo, chica,
  // como la esfera de un cronómetro. Así entra en el círculo sin achicar el
  // número hasta que no se lea.
  const [value, unit] = formatWindowShort(leftMs).split(" ");

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-full flex-col items-center justify-center rounded-full leading-none tabular-nums",
        STYLES[level],
        className,
      )}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full -rotate-90"
        fill="none"
      >
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="7"
          className="opacity-20"
        />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span
        className="font-semibold"
        style={{ fontSize: Math.round(size * 0.34) }}
      >
        {value}
      </span>
      <span
        className="mt-px font-medium opacity-80"
        style={{ fontSize: Math.max(8, Math.round(size * 0.2)) }}
      >
        {unit}
      </span>
    </span>
  );
}
