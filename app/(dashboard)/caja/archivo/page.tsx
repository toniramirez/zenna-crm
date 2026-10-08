import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, Lock, LockOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { monthBounds, todayDateStr } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/validations/payments";
import { MonthNav } from "../../finanzas/month-nav";
import {
  computeDayTotals,
  type DayTotals,
  diffClass,
  formatDiff,
} from "../day-totals";
import type { CashClosingRow } from "../types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

type Props = {
  searchParams: Promise<{ month?: string }>;
};

type PaymentLite = {
  caja_date: string;
  method: PaymentMethod;
  amount: number;
  is_deposit: boolean;
};

/**
 * Archivo de cajas: una fila por día del mes con movimiento, con el efectivo
 * y las transferencias por separado y el cierre (contado vs esperado) si se
 * hizo. Los totales se calculan en vivo; el cierre es la foto guardada.
 */
export default async function CajaArchivoPage({ searchParams }: Props) {
  await requireRole(["owner", "receptionist"]);

  const { month: monthParam } = await searchParams;
  const today = todayDateStr();
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : today.slice(0, 7);
  const { firstDay, lastDay } = monthBounds(`${month}-01`);

  const supabase = await createClient();

  // Un mes con mucho movimiento puede pasar el tope de filas de PostgREST.
  const payments: PaymentLite[] = [];
  let paymentsError: string | null = null;
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("payments")
      .select("caja_date, method, amount, is_deposit")
      .gte("caja_date", firstDay)
      .lte("caja_date", lastDay)
      .order("id")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      console.error("[caja/archivo] payments query failed:", error);
      paymentsError = error.message;
      break;
    }
    payments.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  // Sólo el total de egresos en efectivo de cada caja (sin detalle): es lo
  // que hace falta para saber cuánto efectivo tendría que haber.
  const [expensesResult, closingsResult] = await Promise.all([
    supabase
      .from("expenses")
      .select("amount, cash_source_date")
      .eq("payment_method", "cash")
      .gte("cash_source_date", firstDay)
      .lte("cash_source_date", lastDay),
    supabase
      .from("cash_closings")
      .select("*")
      .gte("caja_date", firstDay)
      .lte("caja_date", lastDay),
  ]);

  if (closingsResult.error) {
    console.error("[caja/archivo] closings query failed:", closingsResult.error);
  }

  const cashExpensesByDay = new Map<string, number>();
  for (const e of expensesResult.data ?? []) {
    if (!e.cash_source_date) continue;
    cashExpensesByDay.set(
      e.cash_source_date,
      (cashExpensesByDay.get(e.cash_source_date) ?? 0) + Number(e.amount),
    );
  }

  const paymentsByDay = new Map<string, PaymentLite[]>();
  for (const p of payments) {
    const list = paymentsByDay.get(p.caja_date) ?? [];
    list.push(p);
    paymentsByDay.set(p.caja_date, list);
  }

  const closings = new Map<string, CashClosingRow>(
    ((closingsResult.data as CashClosingRow[] | null) ?? []).map((c) => [
      c.caja_date,
      c,
    ]),
  );

  const days = [
    ...new Set([
      ...paymentsByDay.keys(),
      ...cashExpensesByDay.keys(),
      ...closings.keys(),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const rows: { day: string; totals: DayTotals; closing: CashClosingRow | null }[] =
    days.map((day) => ({
      day,
      totals: computeDayTotals(
        paymentsByDay.get(day) ?? [],
        cashExpensesByDay.get(day) ?? 0,
      ),
      closing: closings.get(day) ?? null,
    }));

  const sum = (pick: (t: DayTotals) => number) =>
    rows.reduce((acc, r) => acc + pick(r.totals), 0);
  const diffTotal = rows.reduce(
    (acc, r) =>
      r.closing
        ? acc + Number(r.closing.counted_cash) - Number(r.closing.expected_cash)
        : acc,
    0,
  );
  const openPastDays = rows.filter(
    (r) => !r.closing && r.day < today && r.totals.cash > 0,
  ).length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/caja">
            <ArrowLeft className="size-4" />
            Volver a la caja
          </Link>
        </Button>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Archivo de cajas
            </h1>
            <p className="text-sm text-muted-foreground">
              Cada día con su efectivo, sus transferencias y el cierre.
            </p>
          </div>
          <MonthNav month={month} basePath="/caja/archivo" />
        </div>
      </div>

      {paymentsError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">
            No pudimos cargar los cobros del mes.
          </p>
          <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
            {paymentsError}
          </p>
        </div>
      ) : null}

      {/* Totales del mes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Efectivo cobrado" value={formatCurrency(sum((t) => t.cash))} />
        <Stat
          label="Transferencias"
          value={formatCurrency(sum((t) => t.transfer))}
        />
        <Stat
          label="Tarjetas y otros"
          value={formatCurrency(sum((t) => t.other))}
        />
        <Stat
          label="Diferencias de cierre"
          value={formatDiff(diffTotal)}
          valueClass={diffClass(diffTotal)}
          hint={
            openPastDays > 0
              ? `${openPastDays} día${openPastDays === 1 ? "" : "s"} con efectivo sin cerrar`
              : "Todos los días con efectivo están cerrados"
          }
        />
      </div>

      {rows.length === 0 && !paymentsError ? (
        <div className="rounded-md border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No hay movimientos en este mes.
          </p>
        </div>
      ) : rows.length > 0 ? (
        <div className="rounded-md border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Efectivo</TableHead>
                <TableHead className="text-right">Egresos ef.</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-right">Transferencias</TableHead>
                <TableHead className="text-right">Otros</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ day, totals, closing }) => {
                const diff = closing
                  ? Number(closing.counted_cash) - Number(closing.expected_cash)
                  : null;
                const changed =
                  closing &&
                  Math.abs(Number(closing.expected_cash) - totals.expectedCash) >= 0.01;
                return (
                  <TableRow key={day}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link
                        href={day === today ? "/caja" : `/caja?date=${day}`}
                        className="hover:underline capitalize-first"
                      >
                        {format(parseISO(day + "T12:00:00"), "EEE d/M", {
                          locale: es,
                        })}
                      </Link>
                      {totals.deposits > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          incluye señas {formatCurrency(totals.deposits)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.cash)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-700">
                      {totals.cashExpenses > 0
                        ? `−${formatCurrency(totals.cashExpenses)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(totals.expectedCash)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {closing ? formatCurrency(closing.counted_cash) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${diff !== null ? diffClass(diff) : ""}`}
                    >
                      {diff !== null ? formatDiff(diff) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.transfer)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.other)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {closing ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <Lock className="size-3" />
                          Cerrada
                          {changed ? (
                            <span className="text-amber-700">· cambió</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <LockOpen className="size-3" />
                          {day > today ? "Futura" : "Abierta"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total del mes</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(sum((t) => t.cash))}
                </TableCell>
                <TableCell className="text-right tabular-nums text-rose-700">
                  −{formatCurrency(sum((t) => t.cashExpenses))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(sum((t) => t.expectedCash))}
                </TableCell>
                <TableCell />
                <TableCell
                  className={`text-right tabular-nums ${diffClass(diffTotal)}`}
                >
                  {formatDiff(diffTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(sum((t) => t.transfer))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(sum((t) => t.other))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClass = "",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
