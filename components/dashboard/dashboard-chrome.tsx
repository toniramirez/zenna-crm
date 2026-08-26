"use client";

import { Headset, PanelLeft, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "./brand-wordmark";
import { useFocusMode } from "./focus-mode-context";
import { MobileChromeProvider } from "./mobile-chrome";
import { MobileTabBar } from "./mobile-tabbar";
import type { NavItem } from "./nav";
import { NavSearch } from "./nav-search";
import { SidebarNav } from "./sidebar-nav";
import { useInboxUnread } from "./use-inbox-unread";
import { UserMenu } from "./user-menu";

/**
 * Chrome del dashboard. Son dos aplicaciones distintas conviviendo:
 *
 * El **escritorio** usa el rail de íconos de 64px del referente: sin logo, sin
 * etiquetas, tres grupos verticales (herramientas arriba, navegación al
 * medio, cuenta abajo) y el ítem activo marcado con una pastilla durazno.
 * El botón de panel lo expande a 232px mostrando las etiquetas — el rail
 * colapsado es el estado por defecto.
 *
 * El **teléfono** se hace pasar por WhatsApp: tema oscuro (los tokens viven en
 * app/globals.css, colgados de `@media (width < 48rem)`) y navegación en una
 * barra de pestañas abajo, con Chats al centro. Arriba queda apenas la marca;
 * la cuenta y las secciones que no entran están en "Más".
 */
/**
 * Alto real de la ventana y cuánto de ella tapa el teclado.
 *
 * En el teléfono `100dvh` no alcanza: el teclado no es chrome del navegador,
 * así que `dvh` sigue midiendo la pantalla entera y iOS resuelve el estorbo
 * empujando el documento hacia arriba — el encabezado del chat se va de la
 * pantalla y abajo queda una franja muerta. La `visualViewport` sí sabe qué
 * parte se ve: de ahí salen `--app-height` (el alto que toma el shell) y
 * `--kb-inset` (lo que hay que descontarle al respiro del gesto de inicio,
 * que con teclado abierto ya no esquiva nada).
 *
 * El `scrollTo(0, 0)` deshace el empujón: con el shell ya achicado, la barra
 * de escritura queda apoyada sobre las teclas sin que nadie tenga que
 * desplazar nada.
 */
function useViewportMetrics() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const overlap = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop),
      );
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--kb-inset", `${overlap}px`);
      // Con el teclado arriba el navegador ya desplazó el documento; el shell
      // mide lo que se ve, así que ese desplazamiento sobra.
      if (overlap > 0 && window.scrollY !== 0) window.scrollTo(0, 0);
    };

    // Los eventos de la visualViewport llegan de a ráfagas mientras el teclado
    // entra: un rAF por ráfaga alcanza y evita recalcular el layout por cuadro.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--kb-inset");
    };
  }, []);
}

export function DashboardChrome({
  items,
  profile,
  email,
  unreadCount = 0,
  children,
}: {
  items: NavItem[];
  profile: { role: AppRole };
  email: string;
  /** Chats sin leer de la bandeja, para el globo de la pestaña Chats. */
  unreadCount?: number;
  children: ReactNode;
}) {
  useViewportMetrics();

  const { focused, toggle } = useFocusMode();
  const [searchOpen, setSearchOpen] = useState(false);
  const collapsed = focused;

  const showAssistant =
    profile.role === "owner" || profile.role === "receptionist";

  // El número que trae el servidor se congela apenas se navega (el layout no
  // se vuelve a montar), así que la cuenta sigue viva del lado del cliente.
  // Es la misma señal en el rail del escritorio y en la barra del teléfono:
  // desde cualquier sección se ve cuántos chats hay esperando.
  const hasInbox = items.some((item) => item.href === "/crm");
  const liveUnread = useInboxUnread(unreadCount, hasInbox);

  return (
    <MobileChromeProvider value={{ items, email, role: profile.role }}>
      <div
        data-app-shell
        className={cn(
          // `--app-height` y no `h-screen`: los 100vh del navegador móvil
          // (que incluyen la barra de URL retraída) le comían el borde
          // inferior, y `100dvh` —el valor de arranque de la variable— no se
          // entera del teclado. Ver `useViewportMetrics`.
          "grid h-[var(--app-height)] w-full overflow-hidden transition-[grid-template-columns] duration-200",
          collapsed ? "md:grid-cols-[64px_1fr]" : "md:grid-cols-[232px_1fr]",
        )}
      >
        {/*
          Contraído el rail va con px-1.5 y no px-3.5: los 8px que se le
          descuentan se los queda el contenedor de la navegación como padding
          propio (ver más abajo), para que el globo de no leídos —que sobresale
          de la pastilla— no quede cortado. Los ítems no se mueven: todo va
          centrado y siguen midiendo 36px, a 14px del borde.
        */}
        <aside
          className={cn(
            "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border",
            collapsed ? "items-center px-1.5" : "px-3",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-1 pt-3",
              collapsed ? "items-center" : "w-full",
            )}
          >
            <button
              type="button"
              onClick={toggle}
              title={collapsed ? "Expandir menú" : "Contraer menú"}
              aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
              className={cn("rail-item", !collapsed && "rail-item-wide")}
            >
              <PanelLeft className="size-[18px] shrink-0" strokeWidth={1.75} />
              {collapsed ? null : (
                <span className="text-sm font-medium">Contraer</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="Buscar (⌘K)"
              aria-label="Buscar"
              className={cn("rail-item", !collapsed && "rail-item-wide")}
            >
              <Search className="size-[18px] shrink-0" strokeWidth={1.75} />
              {collapsed ? null : (
                <span className="text-sm font-medium">Buscar</span>
              )}
            </button>
          </div>

          {/*
            `overflow-y-auto` también recorta a lo ancho (si un eje deja de ser
            `visible`, el otro se vuelve `auto`), y el recorte cae en el borde
            del padding: ese `px-2` es el que deja asomar el globo de no leídos
            fuera de la pastilla. Son 8px para 6 de globo (4 de desborde + 2 de
            anillo), así que sobra aire y no queda al filo.
          */}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto w-full pt-3",
              collapsed && "flex justify-center px-2",
            )}
          >
            <SidebarNav
              items={items}
              compact={collapsed}
              badges={{ "/crm": liveUnread }}
            />
          </div>

          <div
            className={cn(
              "flex flex-col gap-1 pb-3 pt-2",
              collapsed ? "items-center" : "w-full",
            )}
          >
            {showAssistant ? (
              <Link
                href="/ia"
                title="Asistente"
                aria-label="Asistente"
                className={cn("rail-item", !collapsed && "rail-item-wide")}
              >
                <Headset className="size-[18px] shrink-0" strokeWidth={1.75} />
                {collapsed ? null : (
                  <span className="text-sm font-medium">Asistente</span>
                )}
              </Link>
            ) : null}
            <UserMenu email={email} role={profile.role} compact={collapsed} />
          </div>
        </aside>

        {/*
          La barra de marca es solo de mobile, y ya no lleva navegación: eso
          ahora vive abajo, en la barra de pestañas. Una pantalla que trae su
          propio encabezado a pantalla completa la reemplaza marcándolo con
          `data-mobile-header` (la bandeja de mensajes): así no se apilan dos
          barras y el contenido arranca ~56px más arriba.
        */}
        <div className="flex flex-col min-w-0 min-h-0 [&:has([data-mobile-header])>header]:hidden">
          <header className="md:hidden flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
            <BrandWordmark size="sm" />
          </header>

          {/*
            Padding por defecto para las pantallas de tipo "documento", más el
            hueco de la barra de pestañas para que la última fila no quede
            debajo. Las que van a sangre (agenda, bandeja de WhatsApp) marcan
            su raíz con `data-bleed`, se quedan con el ancho completo y
            reservan ese hueco por su cuenta, adentro de su propio scroll.
          */}
          <main className="flex-1 min-h-0 overflow-y-auto p-3 pb-[calc(0.75rem+var(--tabbar-space))] sm:p-4 sm:pb-[calc(1rem+var(--tabbar-space))] md:p-6 has-[[data-bleed]]:p-0">
            {children}
          </main>
        </div>

        <MobileTabBar
          items={items}
          email={email}
          role={profile.role}
          unreadCount={liveUnread}
        />

        <NavSearch
          items={items}
          open={searchOpen}
          onOpenChange={setSearchOpen}
        />
      </div>
    </MobileChromeProvider>
  );
}
