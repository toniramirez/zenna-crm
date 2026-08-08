"use client";

import { KeyRound, LogOut, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
 *   │  │  📅     💳    ╭───╮   👥   ⋯  │  │  ← cápsula sobre el ítem activo
 *   │  │ Turnos  Caja  │💬⁵³│ Clientas Más│  │
 *   │  ╰────────────────────────────────╯  │
 *   └──────────────────────────────────────┘
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
  const [moreOpen, setMoreOpen] = useState(false);

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

  return (
    <>
      <nav
        data-app-tabbar
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
      >
        {/*
          Pastilla flotante: la lista sigue corriendo por debajo y se ve
          apenas velada, igual que en WhatsApp. El `backdrop-blur` sobre un
          gris más claro que el fondo es lo que la separa del contenido, sin
          necesidad de una línea divisoria.
        */}
        <div className="mx-auto flex max-w-md items-stretch gap-1 rounded-full border border-white/5 bg-secondary/90 px-1.5 py-1 shadow-lg backdrop-blur-xl">
          {primary.map((item) => {
            const Icon = getIcon(item.iconName);
            const active = isActive(pathname, item.href);
            const badge = item.href === "/crm" ? unreadCount : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
                aria-current={active ? "page" : undefined}
                className="tabbar-item"
              >
                <span className="tabbar-pill relative">
                  <Icon
                    className="size-[22px]"
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {badge > 0 ? <TabBadge count={badge} /> : null}
                </span>
                <span className="max-w-full truncate text-[0.6875rem] font-medium">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-active={overflowActive}
            aria-label="Más opciones"
            aria-expanded={moreOpen}
            className="tabbar-item"
          >
            <span className="tabbar-pill">
              <MoreHorizontal className="size-[22px]" strokeWidth={1.75} />
            </span>
            <span className="text-[0.6875rem] font-medium">Más</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 rounded-t-3xl border-border pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
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

/**
 * Globo de no leídos, anclado al ícono. `99+` es el tope: más dígitos rompen
 * la cápsula y de todos modos el número exacto ya no informa nada.
 */
function TabBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1 left-1/2 ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold tabular-nums text-primary-foreground">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> mensajes sin leer</span>
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
