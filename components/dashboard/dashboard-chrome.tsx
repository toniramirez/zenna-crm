"use client";

import { Headset, PanelLeft, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import logoBlanco from "@/public/zenna-logo-blanco.png";
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
 * Alto real de la ventana, cuánto de ella tapa el teclado y desde dónde se ve.
 *
 * En el teléfono `100dvh` no alcanza: el teclado no es chrome del navegador,
 * así que `dvh` sigue midiendo la pantalla entera. La `visualViewport` sí
 * sabe qué parte se ve: de ahí salen `--app-height` (el alto que toma el
 * shell) y `--kb-inset` (lo que hay que descontarle al respiro del gesto de
 * inicio, que con teclado abierto ya no esquiva nada).
 *
 * El teclado llega de dos maneras. En iOS 26 la app instalada hace caso a
 * `interactive-widget=resizes-content` (ver app/layout.tsx): la ventana
 * entera se achica y `innerHeight` queda igual a la visualViewport, así que
 * cuánto tapa el teclado es cuánto le falta a la ventana para la pantalla.
 * Antes de eso —y en Safari— la ventana queda como estaba y la visualViewport
 * se achica dentro de ella: la diferencia es el teclado. Medir sólo la
 * segunda daba 0 en la primera, y la barra de escritura seguía reservando
 * los 34px del gesto de inicio arriba de las teclas.
 *
 * De cualquiera de las dos maneras, al enfocar el campo iOS empuja la página
 * hacia arriba para mostrarlo y después no la suelta, aunque el shell ya se
 * haya achicado y el documento no tenga para dónde desplazarse: la barra de
 * escritura quedaba arriba de todo y entre ella y el teclado un hueco vacío
 * que recién se iba al volver a tocar la pantalla. Por eso, mientras hay un
 * campo con el foco o el teclado arriba, el shell flota (`data-keyboard` en
 * <html>, ver app/globals.css): `fixed` no se mueve con el documento, y
 * `--vv-top` lo baja hasta donde empieza la parte visible
 * (`visualViewport.offsetTop`) por si lo que iOS corrió fue eso. Deshacer el
 * empujón con `scrollTo(0, 0)` corría contra la animación de iOS y perdía.
 *
 * Instalada en la pantalla de inicio hay además un bug de iOS: una página que
 * no es más alta que la pantalla —y el shell nunca lo es, se desplazan sus
 * listas y no el documento— recibe una ventana corta por el alto de la barra
 * de estado (~60px). No es sólo la `visualViewport`: `innerHeight` y el
 * bloque de `position: fixed` también, así que la barra de pestañas flota
 * alta, la lista se corta en seco y abajo queda una franja vacía. Pasa al
 * entrar a la app y también después del teclado, y se corrige recién cuando
 * una desliza el documento.
 *
 * Con la barra de estado translúcida la app ocupa la pantalla entera, así que
 * el alto de la pantalla es el piso: con el teclado abajo y la ventana entre
 * 2 y 120px más corta que ella, el shell toma el alto de la pantalla y
 * `--vp-gap` lleva lo que le falta al bloque de lo `fixed` para llegar al
 * borde, que es lo que baja lo que está fijo abajo (barra de pestañas, hojas,
 * velos). Para eso el shell tiene que estar en el flujo: lo que se pasa de la
 * ventana se pinta sólo si el documento llega hasta ahí, y un shell `fixed`
 * no lo alarga —así fue como la barra de pestañas quedó cortada por la
 * mitad. Cuando iOS se corrige solo, la diferencia vuelve a 0 y todo queda
 * como siempre.
 *
 * Esa falta se mide con una sonda fija y no se deduce de `innerHeight`: en un
 * iPhone de 852pt `innerHeight` llegaba corto mientras lo fijo ya ocupaba la
 * pantalla entera, y la barra de pestañas bajaba de más los 59px de la barra
 * de estado y quedaba cortada contra el borde. La sonda además se entera si
 * iOS le devuelve el alto a lo fijo sin avisar con un `resize`.
 */
function useViewportMetrics() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    let frame = 0;

    // Sólo la app instalada en iOS: en Safari la ventana cambia de alto de
    // verdad cuando la barra de direcciones se esconde o aparece, y en Android
    // o en la compu la pantalla incluye barras del sistema que la app no
    // ocupa, así que ahí el alto de la pantalla no es piso de nada.
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPadOS se presenta como Mac; el touch lo delata.
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      ios &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true);

    /**
     * Alto de la pantalla en la orientación de ahora, o 0 si la ventana no
     * ocupa la pantalla a lo ancho (un iPad en pantalla dividida): ahí la
     * pantalla no dice nada del alto de la ventana. `screen` no gira en iOS.
     */
    const screenHeight = () => {
      const { width, height } = window.screen;
      if (Math.abs(window.innerWidth - width) <= 1) return height;
      if (Math.abs(window.innerWidth - height) <= 1) return width;
      return 0;
    };

    // Del alto del bloque de lo `fixed` sale `--vp-gap`: ver `apply`.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);

    /** Hay un campo de texto con el foco: el teclado está arriba o en camino. */
    const isTyping = () =>
      document.activeElement?.matches(
        "textarea, [contenteditable]:not([contenteditable='false']), input:is(:not([type]), [type='text'], [type='search'], [type='email'], [type='tel'], [type='url'], [type='password'], [type='number'])",
      ) ?? false;

    const apply = () => {
      frame = 0;
      const zoomed = Math.abs(vv.scale - 1) >= 0.01;
      // Con un campo enfocado el shell flota desde ya, antes de que llegue el
      // teclado: así el empujón de iOS no lo agarra en el flujo.
      const typing = ios && isTyping();
      // Teclado por encima de una ventana que no cambió de alto. Sin restar
      // `offsetTop`: cuando el documento no tiene para dónde desplazarse, iOS
      // baja la visualViewport dentro de la ventana en vez de mover la
      // ventana, y descontarlo daba 0 con el teclado arriba.
      const overlay = zoomed
        ? 0
        : Math.max(0, Math.round(window.innerHeight - vv.height));

      let height = Math.round(vv.height);
      let gap = 0;
      let keyboard = overlay;
      if (standalone && !zoomed && overlay === 0) {
        const full = screenHeight();
        const short = full - Math.round(window.innerHeight);
        if (short > 2) {
          if (typing || short > 120) {
            // La ventana misma se achicó: es el teclado. Más de 120px no es
            // la barra de estado; y con un campo enfocado tampoco lo es
            // aunque mida menos (con teclado físico queda sólo la barra de
            // accesorios).
            keyboard = short;
          } else {
            height = full;
            // Lo que le falta a lo fijo, no a `innerHeight`: los dos no
            // siempre quedan cortos juntos.
            const fixed = Math.round(probe.getBoundingClientRect().height);
            gap = Math.max(0, full - fixed);
          }
        }
      }

      const floating = typing || keyboard > 0;
      // Lo `fixed` cuelga de la ventana y `offsetTop` es cuánto bajó la parte
      // visible dentro de ella: el shell arranca ahí. El scroll del documento
      // no entra en la cuenta, a lo `fixed` no lo mueve. Con zoom se queda
      // arriba: perseguir la vista mientras una se pasea por la página
      // ampliada la marearía.
      const top =
        floating && !zoomed ? Math.max(0, Math.round(vv.offsetTop)) : 0;

      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--vp-gap", `${gap}px`);
      root.style.setProperty("--kb-inset", `${keyboard}px`);
      root.style.setProperty("--vv-top", `${top}px`);
      root.toggleAttribute("data-keyboard", floating);
    };

    // Los eventos de la visualViewport llegan de a ráfagas mientras el teclado
    // entra: un rAF por ráfaga alcanza y evita recalcular el layout por cuadro.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    // iOS corrige sus medidas tarde al abrir la app o al volver a ella, a
    // veces sin avisar con un `resize`: se vuelve a medir un rato después.
    let timers: number[] = [];
    const remeasure = () => {
      schedule();
      for (const id of timers) window.clearTimeout(id);
      timers = [300, 1000, 2500].map((ms) => window.setTimeout(schedule, ms));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") remeasure();
    };

    // iOS puede devolverle el alto a lo `fixed` sin avisar con un `resize`
    // (ni dentro de los 2,5 s de `remeasure`): la sonda se entera igual.
    const observer = new ResizeObserver(schedule);
    observer.observe(probe);

    apply();
    remeasure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", remeasure);
    document.addEventListener("visibilitychange", onVisibility);
    // El teclado entra y sale animado, y el último aviso de iOS puede llegar
    // antes de que termine de acomodarse: se vuelve a medir un rato después de
    // tocar un campo o de soltarlo.
    document.addEventListener("focusin", remeasure);
    document.addEventListener("focusout", remeasure);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      for (const id of timers) window.clearTimeout(id);
      observer.disconnect();
      probe.remove();
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", remeasure);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", remeasure);
      document.removeEventListener("focusout", remeasure);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vp-gap");
      root.style.removeProperty("--kb-inset");
      root.style.removeProperty("--vv-top");
      root.removeAttribute("data-keyboard");
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
          // entera del teclado. Ver `useViewportMetrics`. Con el teclado
          // arriba el shell pasa a `fixed` desde app/globals.css
          // (`data-keyboard`); nunca con un `transform`, que lo volvería la
          // referencia de todo lo `fixed` de adentro (la barra de pestañas).
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
          barras y el contenido arranca ~56px más arriba. El logo es el
          blanco sin fondo: esta barra solo existe en el teléfono, y ahí la
          app es siempre oscura.
        */}
        <div className="flex flex-col min-w-0 min-h-0 [&:has([data-mobile-header])>header]:hidden">
          <header className="md:hidden flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
            <Image
              src={logoBlanco}
              alt="Zenna Hair Salon"
              width={69}
              height={28}
              loading="eager"
              className="h-7 w-auto select-none"
            />
          </header>

          {/*
            Padding por defecto para las pantallas de tipo "documento", más el
            hueco de la barra de pestañas para que la última fila no quede
            debajo. Las que van a sangre (agenda, bandeja de WhatsApp) marcan
            su raíz con `data-bleed`, se quedan con el ancho completo y
            reservan ese hueco por su cuenta, adentro de su propio scroll.
            `data-phone-bleed` es lo mismo pero sólo en el teléfono: lo usan
            las pantallas que en el escritorio siguen siendo un documento
            (caja, clientas, finanzas, configuración — ver `PhoneScreen`).
          */}
          <main className="flex-1 min-h-0 overflow-y-auto p-3 pb-[calc(0.75rem+var(--tabbar-space))] sm:p-4 sm:pb-[calc(1rem+var(--tabbar-space))] md:p-6 has-[[data-bleed]]:p-0 phone:has-[[data-phone-bleed]]:p-0">
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
