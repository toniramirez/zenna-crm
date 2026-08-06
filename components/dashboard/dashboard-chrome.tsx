"use client";

import { Headset, PanelLeft, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "./brand-wordmark";
import { useFocusMode } from "./focus-mode-context";
import { MobileSidebar } from "./mobile-sidebar";
import type { NavItem } from "./nav";
import { NavSearch } from "./nav-search";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

/**
 * Chrome del dashboard.
 *
 * El escritorio usa el rail de íconos de 64px del referente: sin logo, sin
 * etiquetas, tres grupos verticales (herramientas arriba, navegación al
 * medio, cuenta abajo) y el ítem activo marcado con una pastilla durazno.
 * El botón de panel lo expande a 232px mostrando las etiquetas — el rail
 * colapsado es el estado por defecto.
 */
export function DashboardChrome({
  items,
  profile,
  email,
  children,
}: {
  items: NavItem[];
  profile: { role: AppRole };
  email: string;
  children: ReactNode;
}) {
  const { focused, toggle } = useFocusMode();
  const [searchOpen, setSearchOpen] = useState(false);
  const collapsed = focused;

  const showAssistant =
    profile.role === "owner" || profile.role === "receptionist";

  return (
    <div
      className={cn(
        "grid h-screen w-full overflow-hidden transition-[grid-template-columns] duration-200",
        collapsed ? "md:grid-cols-[64px_1fr]" : "md:grid-cols-[232px_1fr]",
      )}
    >
      <aside
        className={cn(
          "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border",
          collapsed ? "items-center px-3.5" : "px-3",
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

        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto w-full pt-3",
            collapsed && "flex justify-center",
          )}
        >
          <SidebarNav items={items} compact={collapsed} />
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

      <div className="flex flex-col min-w-0 min-h-0">
        <header className="md:hidden flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <MobileSidebar items={items} />
          <BrandWordmark size="sm" />
          <div className="ml-auto">
            <UserMenu email={email} role={profile.role} compact />
          </div>
        </header>

        {/*
          Padding por defecto para las pantallas de tipo "documento". Las que
          van a sangre (agenda, bandeja de WhatsApp) marcan su raíz con
          `data-bleed` y se quedan con el ancho completo, que es como se ven
          en el referente.
        */}
        <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 has-[[data-bleed]]:p-0">
          {children}
        </main>
      </div>

      <NavSearch items={items} open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
