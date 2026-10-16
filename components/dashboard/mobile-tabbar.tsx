"use client";

import {
  KeyRound,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  getIcon,
  MOBILE_TAB_ORDER,
  MOBILE_TAB_SLOTS,
  type NavItem,
  ROLE_LABEL,
} from "./nav";

/**
 * Navegación del teléfono.
 *
 * En el celular Zenna se usa como se usa WhatsApp: se abre desde la
 * notificación de un mensaje, se contesta, y recién después —si hace falta—
 * se mira la agenda o la caja. Por eso la navegación es una barra abajo con
 * Chats al centro, y no un menú hamburguesa escondido arriba a la izquierda:
 * lo que se usa cien veces por día tiene que estar bajo el pulgar.
 *
 *   ┌──────────────────────────────────────┐
 *   │  ╭────────────────────────────────╮  │
 *   │  │  📅    💳  ╭──────╮  👥    ⋯   │  │  ← lente de vidrio sobre el activo
 *   │  │ Turnos Caja│ 💬⁵³ │Clientas Más │  │
 *   │  │            │Chats │             │  │
 *   │  ╰────────────╰──────╯────────────╯  │
 *   └──────────────────────────────────────┘
 *
 * Es la barra de iOS 26 (la que trae WhatsApp en el iPhone): el ítem activo
 * no se marca con un fondito detrás del ícono sino con una lente de vidrio
 * que cubre ícono y nombre. Al apoyar el dedo la lente se levanta —crece y
 * se vuelve transparente, con canto brillante— y se puede arrastrar de una
 * pestaña a otra; al soltar cae con un resorte sobre la más cercana y
 * navega. Un toque simple es el mismo gesto sin arrastre. Ver `useGlassLens`.
 *
 * Entran cuatro ítems; el resto (Profesionales, Finanzas, Configuración) y la
 * cuenta viven en la hoja "Más". Con menos de cuatro ítems por rol —una
 * profesional sólo ve Turnos y Comisiones— la barra se achica sola, pero
 * "Más" queda siempre: es el único acceso a cerrar sesión.
 */
export function MobileTabBar({
  items,
  email,
  role,
  unreadCount = 0,
}: {
  items: NavItem[];
  email: string;
  role: AppRole;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  /*
   * La pestaña elegida mientras la página nueva todavía carga. Sin esto la
   * lente caería en el destino y volvería al origen hasta que cambie el
   * `pathname`. Guarda desde dónde se salió: cuando la ruta cambia —llegó, o
   * algo redirigió a otro lado— el dato queda viejo solo, sin efecto que lo
   * limpie.
   */
  const [pending, setPending] = useState<{ href: string; from: string } | null>(
    null,
  );

  // Primero los del orden preferido que el rol tenga; después, si sobran
  // slots, lo que haya quedado afuera en el orden del rail.
  const preferred = MOBILE_TAB_ORDER.map((href) =>
    items.find((item) => item.href === href),
  ).filter((item): item is NavItem => Boolean(item));

  const primary = [
    ...preferred,
    ...items.filter((item) => !preferred.includes(item)),
  ].slice(0, MOBILE_TAB_SLOTS);

  const overflow = items.filter((item) => !primary.includes(item));
  const overflowActive = overflow.some((item) => isActive(pathname, item.href));

  const tabs: Tab[] = [
    ...primary.map((item) => ({
      key: item.href,
      href: item.href,
      label: item.shortLabel ?? item.label,
      Icon: getIcon(item.iconName),
      badge: item.href === "/crm" ? unreadCount : 0,
    })),
    { key: "more", label: "Más", Icon: MoreHorizontal, badge: 0 },
  ];
  const moreIndex = tabs.length - 1;

  const activeIndex = tabs.findIndex((tab) =>
    tab.href ? isActive(pathname, tab.href) : overflowActive,
  );
  const pendingIndex =
    pending?.from === pathname
      ? tabs.findIndex((tab) => tab.href === pending.href)
      : -1;
  // -1 = ninguna (p. ej. /cambiar-contrasena): la lente se esconde.
  const selected = moreOpen
    ? moreIndex
    : pendingIndex >= 0
      ? pendingIndex
      : activeIndex;

  const { lensRef, contentRef, initialTransform, grab, drag, release } =
    useGlassLens(tabs.length, selected);
  const trackRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; rect: DOMRect } | null>(null);
  // El toque ya se resolvió en `pointerup`; el `click` que el navegador
  // dispara después no tiene que volver a navegar.
  const swallowClicksUntil = useRef(0);

  /** Posición de la lente (en pestañas) centrada bajo el dedo. */
  function lensAt(clientX: number, rect: DOMRect) {
    const raw = ((clientX - rect.left) / rect.width) * tabs.length - 0.5;
    return rubberBand(raw, 0, tabs.length - 1);
  }

  function choose(index: number) {
    const tab = tabs[index];
    if (!tab.href) {
      setMoreOpen(true);
      return;
    }
    if (tab.href === pathname) return;
    setPending({ href: tab.href, from: pathname });
    router.push(tab.href);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, rect };
    grab(lensAt(e.clientX, rect));
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (press.current?.id !== e.pointerId) return;
    drag(lensAt(e.clientX, press.current.rect));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (press.current?.id !== e.pointerId) return;
    const { rect } = press.current;
    press.current = null;
    const index = Math.round(
      clamp(lensAt(e.clientX, rect), 0, tabs.length - 1),
    );
    swallowClicksUntil.current = performance.now() + 600;
    release(index);
    choose(index);
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (press.current?.id !== e.pointerId) return;
    press.current = null;
    release(selected);
  }

  function onClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
    if (performance.now() < swallowClicksUntil.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <>
      <nav
        data-app-tabbar
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-[calc(0px-var(--vp-gap))] z-40 px-4 pb-[var(--tabbar-bottom)] md:hidden"
      >
        {/*
          Los eventos de puntero viven en la barra entera y no en cada link:
          el arrastre empieza en una pestaña y termina en otra. Los <Link>
          quedan igual —para el teclado, el lector de pantalla y el prefetch—
          pero el toque lo resuelve `onPointerUp`.
        */}
        <div
          className="tabbar"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
        >
          {/*
            Pastilla flotante: la lista sigue corriendo por debajo y se ve
            apenas velada, igual que en WhatsApp. El material va en una capa
            hermana y no en el contenedor: si la barra misma tuviera
            `backdrop-filter`, el vidrio de la lente sólo vería lo que hay
            dentro de la barra y en Safari se rompe el desenfoque anidado.
          */}
          <div aria-hidden className="tabbar-surface" />

          <div ref={trackRef} className="tabbar-track">
            {tabs.map((tab, index) => {
              const content = <TabFace tab={tab} />;
              return tab.href ? (
                <Link
                  key={tab.key}
                  href={tab.href}
                  draggable={false}
                  aria-current={index === activeIndex ? "page" : undefined}
                  className="tabbar-item"
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-label="Más opciones"
                  aria-expanded={moreOpen}
                  className="tabbar-item"
                >
                  {content}
                </button>
              );
            })}

            {/*
              La lente lleva adentro una copia de la fila entera, pintada en el
              color activo y corrida para que coincida con la de abajo. Así el
              color "activo" no es de una pestaña sino de lo que la lente tiene
              encima: al arrastrar, cada ícono se enciende al pasar por debajo,
              y al levantarse la lente lo agranda como una lupa.
            */}
            <div
              ref={lensRef}
              aria-hidden
              data-hidden={selected < 0}
              className="tabbar-lens"
              style={{
                width: `${100 / tabs.length}%`,
                transform: initialTransform.lens,
              }}
            >
              <div
                ref={contentRef}
                className="tabbar-lens-content"
                style={{
                  width: `${tabs.length * 100}%`,
                  transform: initialTransform.content,
                }}
              >
                {tabs.map((tab) => (
                  <span key={tab.key} className="tabbar-item">
                    <TabFace tab={tab} active />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="bottom-[calc(0px-var(--vp-gap))] gap-0 rounded-t-3xl border-border pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetTitle className="sr-only">Más opciones</SheetTitle>
          <SheetDescription className="sr-only">
            Secciones que no entran en la barra y opciones de la cuenta
          </SheetDescription>

          {/* Agarradera: la señal de "esto se arrastra para cerrar". */}
          <span
            aria-hidden
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40"
          />

          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.8125rem] font-semibold text-secondary-foreground">
              {initialsFromEmail(email)}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[0.9375rem] font-medium">
                {email}
              </div>
              <div className="text-[0.8125rem] text-muted-foreground">
                {ROLE_LABEL[role]}
              </div>
            </div>
          </div>

          {overflow.length > 0 ? (
            <div className="border-t border-border py-1">
              {overflow.map((item) => {
                const Icon = getIcon(item.iconName);
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    // Cerrar acá y no en un efecto sobre `pathname`: el <Sheet>
                    // no se desmonta al navegar, así que sin esto queda abierto
                    // arriba de la pantalla nueva.
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3.5 px-4 py-3 text-[0.9375rem]",
                      active
                        ? "font-medium text-foreground"
                        : "text-foreground/90",
                    )}
                  >
                    <Icon
                      className="size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ) : null}

          <div className="border-t border-border py-1">
            <Link
              href="/cambiar-contrasena"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3.5 px-4 py-3 text-[0.9375rem] text-foreground/90"
            >
              <KeyRound
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              Cambiar contraseña
            </Link>
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-[0.9375rem] text-destructive"
              >
                <LogOut className="size-5 shrink-0" strokeWidth={1.75} />
                Cerrar sesión
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

type Tab = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Sin `href` es "Más": abre la hoja en vez de navegar. */
  href?: string;
  badge: number;
};

function TabFace({ tab, active = false }: { tab: Tab; active?: boolean }) {
  const { Icon } = tab;
  return (
    <>
      <span className="relative">
        <Icon className="size-[1.375rem]" strokeWidth={active ? 2 : 1.6} />
        {tab.badge > 0 ? <TabBadge count={tab.badge} /> : null}
      </span>
      <span className="max-w-full truncate px-0.5 text-[0.625rem] leading-[1.2] font-medium">
        {tab.label}
      </span>
    </>
  );
}

/**
 * La lente de vidrio: un resorte para la posición y otro para el tamaño.
 *
 * Todo se mide en pestañas (0 = la primera) y se pinta con `translate` en
 * porcentaje, así que no hace falta medir la barra salvo para pasar el dedo a
 * pestañas — y el primer render del servidor ya sale con la lente en su
 * lugar. Durante el gesto React no se entera de nada: cada cuadro escribe el
 * `transform` directo en el DOM, porque un render por cuadro en un teléfono
 * se nota.
 *
 * Los resortes van algo sub-amortiguados: la lente pasa un pelo de largo y
 * vuelve, y al levantarse rebota un poco al crecer. Mientras se mueve se
 * estira en la dirección del movimiento. Es eso —y no la duración— lo que la
 * hace sentir líquida en vez de deslizarse como un cursor.
 */
function useGlassLens(count: number, selected: number) {
  const lensRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const start = Math.max(selected, 0);
  const [initialTransform] = useState(() => ({
    lens: lensTransform(start, 1, 1),
    content: contentTransform(start, count),
  }));
  const motion = useRef({
    x: start,
    v: 0,
    to: start,
    s: 1,
    sv: 0,
    sTo: 1,
    held: false,
    shown: selected >= 0,
    count,
    frame: 0,
    last: 0,
  });

  function paint() {
    const m = motion.current;
    const lens = lensRef.current;
    const content = contentRef.current;
    if (!lens || !content) return;
    const stretch = Math.min(Math.abs(m.v) * 0.03, 0.14);
    lens.style.transform = lensTransform(
      m.x,
      m.s * (1 + stretch),
      m.s * (1 - stretch / 2),
    );
    content.style.transform = contentTransform(m.x, m.count);
  }

  function tick(time: number) {
    const m = motion.current;
    const dt = m.last ? clamp((time - m.last) / 1000, 0, 1 / 30) : 1 / 60;
    m.last = time;
    for (let i = 0; i < 2; i++) step(m, dt / 2);
    const settled =
      Math.abs(m.x - m.to) < 5e-4 &&
      Math.abs(m.v) < 5e-3 &&
      Math.abs(m.s - m.sTo) < 5e-4 &&
      Math.abs(m.sv) < 5e-3;
    if (settled) {
      m.x = m.to;
      m.s = m.sTo;
      m.v = m.sv = 0;
    }
    paint();
    m.frame = settled ? 0 : requestAnimationFrame(tick);
  }

  function animate() {
    const m = motion.current;
    if (prefersReducedMotion()) {
      cancelAnimationFrame(m.frame);
      m.frame = 0;
      m.x = m.to;
      m.s = m.sTo;
      m.v = m.sv = 0;
      paint();
      return;
    }
    if (m.frame) return;
    m.last = 0;
    m.frame = requestAnimationFrame(tick);
  }

  function lift(on: boolean) {
    motion.current.held = on;
    motion.current.sTo = on ? LIFT : 1;
    if (lensRef.current) lensRef.current.dataset.lifted = String(on);
  }

  /** Va derecho a `x`, sin viaje: cuando no había lente visible. */
  function place(x: number) {
    const m = motion.current;
    m.x = m.to = x;
    m.v = 0;
    m.shown = true;
    paint();
  }

  // Los cambios que no vienen del dedo (volver atrás, abrir "Más", llegar a
  // una página por un link de adentro) mueven la lente con el mismo resorte.
  useEffect(() => {
    const m = motion.current;
    if (selected < 0) {
      m.shown = false;
      return;
    }
    if (m.held) return; // mientras hay dedo, manda el dedo
    if (!m.shown) {
      place(selected);
      return;
    }
    m.to = selected;
    animate();
    // `place` y `animate` sólo tocan refs: no son dependencias reales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    motion.current.count = count;
  }, [count]);

  useEffect(() => {
    const m = motion.current;
    return () => cancelAnimationFrame(m.frame);
  }, []);

  return {
    lensRef,
    contentRef,
    initialTransform,
    /** El dedo se apoyó: la lente salta hacia ahí y se levanta. */
    grab(x: number) {
      if (!motion.current.shown) place(x);
      motion.current.to = x;
      lift(true);
      animate();
    },
    drag(x: number) {
      motion.current.to = x;
      animate();
    },
    /** El dedo se fue: la lente baja y cae sobre la pestaña `index`. */
    release(index: number) {
      motion.current.to = index;
      lift(false);
      animate();
    },
  };
}

/** Cuánto crece la lente levantada. Sobresale de la barra, como en iOS. */
const LIFT = 1.24;

// Resortes con masa 1: rigidez y amortiguación crítica × factor.
const X_STIFF = 420;
const X_DAMP = 2 * Math.sqrt(X_STIFF) * 0.68;
const S_STIFF = 520;
const S_DAMP = 2 * Math.sqrt(S_STIFF) * 0.5;

function step(
  m: { x: number; v: number; to: number; s: number; sv: number; sTo: number },
  dt: number,
) {
  m.v += (-X_STIFF * (m.x - m.to) - X_DAMP * m.v) * dt;
  m.x += m.v * dt;
  m.sv += (-S_STIFF * (m.s - m.sTo) - S_DAMP * m.sv) * dt;
  m.s += m.sv * dt;
}

function lensTransform(x: number, sx: number, sy: number) {
  return `translate3d(${x * 100}%,0,0) scale(${sx},${sy})`;
}

/** Contra-desplaza la copia de la fila para que quede alineada con la real. */
function contentTransform(x: number, count: number) {
  return `translate3d(${(-x * 100) / count}%,0,0)`;
}

/** Pasado el borde la lente sigue al dedo, pero con resistencia. */
function rubberBand(x: number, min: number, max: number) {
  if (x < min) return min - (min - x) * 0.18;
  if (x > max) return max + (x - max) * 0.18;
  return x;
}

function clamp(x: number, min: number, max: number) {
  return Math.min(Math.max(x, min), max);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Globo de no leídos, anclado al ícono. `99+` es el tope: más dígitos rompen
 * la cápsula y de todos modos el número exacto ya no informa nada.
 */
function TabBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1 left-1/2 ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-semibold tabular-nums text-primary-foreground">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> {count === 1 ? "chat" : "chats"} sin leer</span>
    </span>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "??";
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "??";
}
