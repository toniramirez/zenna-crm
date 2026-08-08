"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppRole } from "@/lib/auth";
import type { NavItem } from "./nav";
import { UserMenu } from "./user-menu";

/**
 * En mobile el dashboard dibuja una barra propia con la marca. Las pantallas
 * que ya traen su propio encabezado a pantalla completa —la bandeja de
 * mensajes— quedaban con dos barras apiladas y ~116px de cromo antes del
 * primer chat.
 *
 * Solución: esas pantallas marcan su barra con `data-mobile-header` y el chrome
 * esconde la suya (ver `DashboardChrome`). Como la navegación vive abajo en la
 * barra de pestañas, lo único que necesitan traerse adentro es la cuenta:
 * montan `<MobileChromeAccount />` y este contexto le acerca el mail y el rol
 * sin tener que pasarlos a mano por el layout y la página.
 */
type MobileChromeValue = {
  items: NavItem[];
  email: string;
  role: AppRole;
};

const MobileChromeContext = createContext<MobileChromeValue | null>(null);

export function MobileChromeProvider({
  value,
  children,
}: {
  value: MobileChromeValue;
  children: ReactNode;
}) {
  return (
    <MobileChromeContext.Provider value={value}>
      {children}
    </MobileChromeContext.Provider>
  );
}

/** Avatar de la cuenta, con el mismo menú que el rail de escritorio. */
export function MobileChromeAccount() {
  const ctx = useContext(MobileChromeContext);
  if (!ctx) return null;
  return (
    <span className="md:hidden">
      <UserMenu email={ctx.email} role={ctx.role} compact />
    </span>
  );
}
