"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
  ChipRow,
  FilterChip,
  PHONE_TITLE,
  PhoneHeader,
  PhoneScreen,
} from "@/components/dashboard/phone-screen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const FINANZAS_TABS = [
  { value: "estadisticas", label: "Estadísticas" },
  { value: "ingresos", label: "Ingresos" },
  { value: "gastos-fijos", label: "Gastos fijos" },
  { value: "profesionales", label: "Profesionales" },
] as const;

export type FinanzasTab = (typeof FINANZAS_TABS)[number]["value"];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return format(date, "yyyy-MM");
}

/**
 * Finanzas en sus dos formas.
 *
 * En el escritorio sigue siendo el documento de siempre: título y solapas.
 * En el teléfono toma el encabezado de la agenda: el mes como título grande
 * —es lo que se recorre acá, como los días en la agenda— con las flechas al
 * costado, y las solapas convertidas en pastillas que se deslizan.
 *
 *   ┌───────────────────────────────┐
 *   │                            (A)│
 *   │ Octubre                 ‹   › │
 *   │ Finanzas de octubre de 2026   │
 *   │ (Estadísticas)(Ingresos)(Gas… │
 *   ├───────────────────────────────┤
 *   │ ╭ Ingresos ─╮ ╭ Egresos ──╮   │
 *   └───────────────────────────────┘
 *
 * Los paneles son los mismos en las dos: se renderizan una sola vez y cada
 * uno se acomoda al teléfono por su cuenta.
 */
export function FinanzasScreen({
  month,
  initialTab,
  basis,
  panels,
}: {
  /** "YYYY-MM" */
  month: string;
  initialTab: FinanzasTab;
  /** Criterio de Ingresos (`?base=`), para no perderlo al cambiar de mes. */
  basis: string;
  panels: Record<FinanzasTab, ReactNode>;
}) {
  const [tab, setTab] = useState<FinanzasTab>(initialTab);

  function changeTab(next: FinanzasTab) {
    setTab(next);
    // La solapa queda en la URL: recargar o cambiar de mes vuelve a ella.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const monthHref = (m: string) =>
    `/finanzas?month=${m}&tab=${tab}${tab === "ingresos" ? `&base=${basis}` : ""}`;

  return (
    <PhoneScreen
      header={
        <PhoneHeader
          title={
            <MonthTitle
              month={month}
              prevHref={monthHref(shiftMonth(month, -1))}
              nextHref={monthHref(shiftMonth(month, 1))}
            />
          }
        >
          <ChipRow>
            {FINANZAS_TABS.map((t) => (
              <FilterChip
                key={t.value}
                active={tab === t.value}
                onClick={() => changeTab(t.value)}
              >
                {t.label}
              </FilterChip>
            ))}
          </ChipRow>
        </PhoneHeader>
      }
    >
      <div className="max-w-6xl space-y-6 phone:space-y-0 phone:px-4 phone:pt-1">
        <h1 className="print-hide text-2xl font-semibold tracking-tight phone:hidden">
          Finanzas
        </h1>

        <Tabs
          value={tab}
          onValueChange={(value) => changeTab(value as FinanzasTab)}
          className="space-y-4"
        >
          <TabsList className="print-hide phone:hidden">
            {FINANZAS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {FINANZAS_TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="space-y-4">
              {panels[t.value]}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </PhoneScreen>
  );
}

/** "Octubre" con las flechas al costado; el año sólo si no es el actual. */
function MonthTitle({
  month,
  prevHref,
  nextHref,
}: {
  month: string;
  prevHref: string;
  nextHref: string;
}) {
  const date = parseISO(month + "-01T12:00:00");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const title = format(date, sameYear ? "MMMM" : "MMMM yyyy", { locale: es });

  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex items-center gap-2">
        <h1 className={cn(PHONE_TITLE, "truncate first-letter:uppercase")}>
          {title}
        </h1>
        <div className="-mr-2 ml-auto flex items-center">
          <MonthArrow href={prevHref} label="Mes anterior">
            <ChevronLeft className="size-5" strokeWidth={2} />
          </MonthArrow>
          <MonthArrow href={nextHref} label="Mes siguiente">
            <ChevronRight className="size-5" strokeWidth={2} />
          </MonthArrow>
        </div>
      </div>
      <p className="mt-1.5 text-[0.8125rem] text-[var(--wa-text-2)]">
        Finanzas de {format(date, "MMMM 'de' yyyy", { locale: es })}
      </p>
    </div>
  );
}

function MonthArrow({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      title={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text)] active:bg-[var(--wa-hover)]"
    >
      {children}
    </Link>
  );
}

/** El candado del PIN, con el mismo encabezado que la pantalla abierta. */
export function FinanzasLockedScreen({ children }: { children: ReactNode }) {
  return (
    <PhoneScreen header={<PhoneHeader title="Finanzas" />}>
      <div className="max-w-6xl space-y-6 phone:px-4">
        <h1 className="text-2xl font-semibold tracking-tight phone:hidden">
          Finanzas
        </h1>
        {children}
      </div>
    </PhoneScreen>
  );
}
