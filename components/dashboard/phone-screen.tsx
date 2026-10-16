"use client";

import { type LucideIcon, Plus } from "lucide-react";
import Link from "next/link";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";
import { MobileChromeAccount } from "./mobile-chrome";

/**
 * Piezas de las pantallas del teléfono.
 *
 * La agenda (turnos/mobile-agenda.tsx) fijó el idioma: título grande arriba a
 * la izquierda, la cuenta arriba a la derecha, filtros en pastillas, tarjetas
 * redondeadas sobre el gris de WhatsApp y la acción principal en un botón
 * flotante sobre la barra de pestañas. Caja, clientas, finanzas y
 * configuración hablan el mismo idioma con estas piezas, así que pasar de una
 * pestaña a otra no se siente como cambiar de app.
 */

/** El corte del teléfono: el mismo `md` en el que el rail se vuelve pestañas. */
const PHONE_QUERY = "(max-width: 767px)";

function subscribePhone(onChange: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** `null` mientras no se sabe: en el servidor y durante la hidratación. */
export function useIsPhone(): boolean | null {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null,
  );
}

/**
 * Una pantalla para el teléfono y otra para el escritorio, sin parpadeo.
 *
 * El servidor no sabe el ancho, así que manda las dos y el CSS esconde la que
 * sobra; apenas hidrata, la que no corresponde se desmonta (sus diálogos, sus
 * efectos y sus sondeos no tienen por qué correr escondidos). Los envoltorios
 * no cambian de lugar, así que la que queda no se vuelve a montar.
 */
export function PhoneOrDesktop({
  phone,
  desktop,
}: {
  phone: ReactNode;
  desktop: ReactNode;
}) {
  const isPhone = useIsPhone();
  return (
    <>
      {isPhone !== false ? (
        <div className="h-full md:hidden">{phone}</div>
      ) : null}
      {isPhone !== true ? <div className="phone:hidden">{desktop}</div> : null}
    </>
  );
}

/** El título grande: "Chats", "Caja", "Octubre". */
export const PHONE_TITLE =
  "font-display text-[2rem] font-bold leading-none tracking-tight";

/**
 * Esqueleto de una pantalla del teléfono: encabezado fijo y el resto con su
 * propio desplazamiento, que deja pasar la barra de pestañas (y el botón
 * flotante, si hay).
 *
 * Todo lo de teléfono va con `phone:` (`max-md:` sólo en pantalla), así una
 * pantalla que en el escritorio sigue siendo la misma (finanzas,
 * configuración) puede envolverse entera: ahí —y en el papel— esto es un
 * `div` cualquiera, el encabezado no se ve y el contenido fluye en el `main`
 * como siempre.
 */
export function PhoneScreen({
  header,
  children,
  fab,
  scrollRef,
  scrollClassName,
}: {
  header: ReactNode;
  children: ReactNode;
  fab?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  scrollClassName?: string;
}) {
  /** La lista se corrió: el encabezado gana su filete, como en iOS. */
  const [scrolled, setScrolled] = useState(false);

  return (
    <div
      data-phone-bleed
      className="wa-scope phone:relative phone:flex phone:h-full phone:min-h-0 phone:flex-col phone:bg-[var(--wa-panel)] phone:text-[var(--wa-text)]"
    >
      {/*
        `data-mobile-header` hace que el chrome esconda su barra con el logo;
        la cuenta se trae acá adentro (ver `PhoneHeader`).
      */}
      <div
        data-mobile-header
        className={cn(
          "hidden shrink-0 border-b transition-colors phone:block",
          scrolled ? "border-[var(--wa-divider)]" : "border-transparent",
        )}
      >
        {header}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
        className={cn(
          "phone:min-h-0 phone:flex-1 phone:overflow-y-auto phone:overscroll-contain",
          fab
            ? "phone:pb-[calc(6rem+var(--tabbar-space))]"
            : "phone:pb-[calc(2rem+var(--tabbar-space))]",
          scrollClassName,
        )}
      >
        {children}
      </div>

      {fab ? <div className="hidden phone:block">{fab}</div> : null}
    </div>
  );
}

/**
 * Encabezado: una fila de 44px con lo que va a la izquierda (`leading`), las
 * acciones y la cuenta a la derecha, y abajo el título grande. Lo que se pase
 * como hijos (pastillas, buscador) va debajo del título.
 */
export function PhoneHeader({
  leading,
  actions,
  title,
  children,
}: {
  leading?: ReactNode;
  actions?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex h-11 items-center gap-2 px-4">
        {leading}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <MobileChromeAccount />
        </div>
      </div>
      {title === undefined ? null : typeof title === "string" ? (
        <h1 className={cn(PHONE_TITLE, "px-4 pt-1 pb-3")}>{title}</h1>
      ) : (
        title
      )}
      {children}
    </>
  );
}

/** Botón redondo de ícono para la fila de arriba del encabezado. */
export function HeaderIconButton({
  label,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text)] active:bg-[var(--wa-hover)] disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** La pastilla verde de "volver a hoy", la misma de la agenda. */
export function TodayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 rounded-full bg-[var(--wa-chip-on)] px-3.5 text-[0.8125rem] font-semibold text-[var(--wa-chip-on-text)] active:opacity-80"
    >
      Hoy
    </button>
  );
}

/**
 * Botón redondo flotante para la acción principal. No una barra a lo ancho:
 * abajo de todo ya está la barra de pestañas, y dos barras apiladas se comen
 * 130px de pantalla. Va justo arriba de ella y a la derecha, que es el gesto
 * del "+" de WhatsApp.
 */
export function Fab({
  label,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "absolute right-4 bottom-[calc(1rem+var(--tabbar-space))] z-30 flex size-14 items-center justify-center rounded-2xl bg-[var(--wa-badge)] text-[var(--wa-badge-text)] shadow-[0_12px_28px_-10px_rgb(0_0_0/0.85)] transition-transform active:scale-95",
        className,
      )}
      {...props}
    >
      {children ?? <Plus className="size-6" strokeWidth={2.25} />}
    </button>
  );
}

/** Pastilla de filtro: "Todas 6", "Efectivo 3". */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] transition-colors",
        active
          ? "bg-[var(--wa-chip-on)] font-medium text-[var(--wa-chip-on-text)]"
          : "bg-[var(--wa-search-bg)] text-[var(--wa-text-2)]",
      )}
    >
      {children}
    </button>
  );
}

/** Fila de pastillas que se desliza de costado cuando no entran. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="hide-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
      {children}
    </div>
  );
}

/** Interruptor de dos o tres opciones: "Día │ Semana". */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-[var(--wa-search-bg)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-full px-3 text-[0.8125rem] font-medium transition-colors",
            value === option.value
              ? "bg-[color-mix(in_oklab,var(--wa-text)_16%,var(--wa-search-bg))] text-[var(--wa-text)]"
              : "text-[var(--wa-text-2)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Etiqueta chica de estado. Fondo translúcido, texto en el tono claro. */
export function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[0.6875rem] font-medium whitespace-nowrap tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tonos de `Pill` para el oscuro del teléfono. */
export const PILL_TONE = {
  neutral: "bg-white/10 text-[var(--wa-text-2)]",
  green: "bg-emerald-400/15 text-emerald-300",
  amber: "bg-amber-400/15 text-amber-300",
  red: "bg-rose-400/15 text-rose-300",
  blue: "bg-sky-400/15 text-sky-300",
} as const;

/**
 * Un bloque de la pantalla con su título y, a la derecha, el dato que lo
 * resume ("Por cobrar · 3", "$ 48.000"). Es el mismo renglón que encabeza
 * cada día en la agenda.
 */
export function PhoneSection({
  title,
  meta,
  children,
  className,
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("pt-5", className)}>
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
        <h2 className="truncate text-[0.9375rem] font-semibold">{title}</h2>
        {meta === undefined || meta === null ? null : (
          <span className="shrink-0 text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Superficie de tarjeta: el gris un punto más claro que el fondo. */
export const PHONE_CARD =
  "rounded-2xl bg-card ring-1 ring-white/[0.04] ring-inset";

/**
 * Lista agrupada, como los ajustes del teléfono: filas dentro de una misma
 * tarjeta, separadas por un filete.
 */
export function PhoneGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        PHONE_CARD,
        "mx-4 divide-y divide-[var(--wa-divider)] overflow-hidden",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/**
 * Una fila de `PhoneGroup`. Con `href` es un link, con `onClick` un botón y
 * sin ninguno de los dos, texto.
 */
export function PhoneRow({
  leading,
  title,
  subtitle,
  trailing,
  chevron = false,
  href,
  onClick,
  className,
  muted = false,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
  muted?: boolean;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing}
      {chevron ? (
        <svg
          aria-hidden
          viewBox="0 0 8 14"
          className="h-3.5 w-2 shrink-0 text-[var(--wa-text-3)]"
        >
          <path
            d="M1 1l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </>
  );

  const rowClass = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-left",
    (href || onClick) && "active:bg-[var(--wa-hover)]",
    muted && "opacity-55",
    className,
  );

  return (
    <li>
      {href ? (
        <Link href={href} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/** Ícono en un círculo de color, para el arranque de una fila. */
export function RowIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--wa-search-bg)] text-[var(--wa-text-2)]",
        className,
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.9} />
    </span>
  );
}

/** Estado vacío: ícono en un círculo, una frase y, si va, una acción. */
export function PhoneEmpty({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-8 pt-10 pb-4 text-center",
        className,
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-[var(--wa-search-bg)] text-[var(--wa-text-2)]">
        <Icon className="size-7" strokeWidth={1.6} />
      </span>
      <p className="mt-4 text-[1.0625rem] font-semibold">{title}</p>
      {children ? (
        <p className="mt-1 max-w-[17rem] text-[0.8125rem] leading-relaxed text-balance text-[var(--wa-text-2)]">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Botón de pastilla verde para el estado vacío ("Agendar turno"). */
export function PillButton({
  className,
  children,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--wa-chip-on)] px-5 text-[0.875rem] font-semibold text-[var(--wa-chip-on-text)] active:opacity-80 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Error de carga. En una caja registradora un "no hay nada" mentiroso hace que
 * un cobro se pierda: si la consulta falló, se dice.
 */
export function PhoneError({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="mx-4 rounded-2xl bg-rose-400/10 p-4 ring-1 ring-rose-400/25 ring-inset">
      <p className="text-[0.875rem] font-semibold text-rose-300">{title}</p>
      {children ? (
        <p className="mt-1 text-[0.8125rem] text-[var(--wa-text-2)]">
          {children}
        </p>
      ) : null}
      {detail ? (
        <p className="mt-2 font-mono text-[0.6875rem] break-all text-[var(--wa-text-3)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
