import { formatCurrency } from "@/lib/format";
import type { PaymentMethod } from "@/lib/validations/payments";

/**
 * Cómo se controla la plata de una caja: el efectivo se cuenta en el cajón,
 * las transferencias se miran en el home banking, y el resto (tarjetas,
 * MercadoPago) en sus propios resúmenes. Por eso se agrupa en tres.
 */
export type MethodGroup = "cash" | "transfer" | "other";

export const METHOD_GROUPS: { value: MethodGroup; label: string; hint: string }[] = [
  { value: "cash", label: "Efectivo", hint: "Se cuenta en el cajón" },
  { value: "transfer", label: "Transferencias", hint: "Controlar en el banco" },
  { value: "other", label: "Tarjetas y otros", hint: "Débito, crédito, MercadoPago" },
];

export function methodGroup(method: PaymentMethod): MethodGroup {
  if (method === "cash") return "cash";
  if (method === "transfer") return "transfer";
  return "other";
}

export type DayTotals = {
  cash: number;
  transfer: number;
  other: number;
  total: number;
  /** De lo cobrado, cuánto fueron señas de turnos (de este u otro día). */
  deposits: number;
  count: number;
  cashExpenses: number;
  /** Efectivo cobrado − egresos en efectivo atribuidos a esta caja. */
  expectedCash: number;
};

export function computeDayTotals(
  payments: { method: PaymentMethod; amount: number; is_deposit: boolean }[],
  cashExpenses: number,
): DayTotals {
  const t = { cash: 0, transfer: 0, other: 0, deposits: 0 };
  for (const p of payments) {
    const amount = Number(p.amount);
    t[methodGroup(p.method)] += amount;
    if (p.is_deposit) t.deposits += amount;
  }
  return {
    ...t,
    total: t.cash + t.transfer + t.other,
    count: payments.length,
    cashExpenses,
    expectedCash: t.cash - cashExpenses,
  };
}

/** Diferencia de un cierre (contado − esperado) con signo: "+$500", "−$1.200". */
export function formatDiff(diff: number): string {
  if (Math.abs(diff) < 0.01) return formatCurrency(0);
  return `${diff > 0 ? "+" : "−"}${formatCurrency(Math.abs(diff))}`;
}

/** Verde si cierra, ámbar si sobra, rojo si falta. */
export function diffClass(diff: number): string {
  if (Math.abs(diff) < 0.01) return "text-emerald-700";
  return diff > 0 ? "text-amber-700" : "text-rose-700";
}
