"use client";

import { ArrowDownRight, ArrowUpRight, Eye, EyeOff, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";

const STORAGE_KEY = "caja:amounts-hidden";
const MASK = "$ •••••";

type Props = {
  isOwner: boolean;
  cashToRender: number;
  cashIncome: number;
  cashExpensesForDay: number;
  totalIncome: number;
  paymentsCount: number;
  totalExpensesMonth: number;
  netResultDay: number;
  monthLabel: string;
};

export function CajaSummaryCards({
  isOwner,
  cashToRender,
  cashIncome,
  cashExpensesForDay,
  totalIncome,
  paymentsCount,
  totalExpensesMonth,
  netResultDay,
  monthLabel,
}: Props) {
  const [hidden, setHidden] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }, []);

  function toggle() {
    setHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  const show = hydrated && !hidden;
  const money = (n: number) => (show ? formatCurrency(n) : MASK);
  const moneySigned = (n: number) =>
    show ? `−${formatCurrency(n)}` : `− ${MASK}`;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="h-8 gap-1.5 text-xs text-muted-foreground"
          aria-pressed={hidden}
          aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
        >
          {hidden ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {hidden ? "Mostrar montos" : "Ocultar montos"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Wallet className="size-3.5 text-gold" />
            Efectivo a rendir
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {money(cashToRender)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cobrado en efectivo {money(cashIncome)}
            {cashExpensesForDay > 0
              ? ` − egresos atribuidos a esta caja ${money(cashExpensesForDay)}`
              : ""}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ArrowUpRight className="size-3.5 text-emerald-600" />
            Ingresos del día
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {money(totalIncome)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {paymentsCount} cobro{paymentsCount === 1 ? "" : "s"}
          </p>
        </div>

        {isOwner ? (
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <ArrowDownRight className="size-3.5 text-rose-600" />
              Egresos del mes
            </div>
            <div className="mt-2 text-3xl font-semibold tabular-nums text-rose-700">
              {moneySigned(totalExpensesMonth)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground capitalize-first">
              {monthLabel} · resultado del día:{" "}
              <strong
                className={
                  netResultDay >= 0 ? "text-emerald-700" : "text-rose-700"
                }
              >
                {money(netResultDay)}
              </strong>
            </p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-5 shadow-sm opacity-60">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              Egresos
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Solo la dueña los ve.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
