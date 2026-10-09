import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
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
import { monthBounds, todayDateStr, ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { MonthNav } from "../../finanzas/month-nav";
import { PinGate } from "../../finanzas/pin-gate";
import {
  computeDayTotals,
  type DayTotals,
  diffClass,
  formatDiff,
  type MethodGroup,
} from "../day-totals";
import type { CashClosingRow } from "../types";
import { CajaControls } from "./controls";
import { fetchMonthPayments, fetchMonthSales } from "./data";
import { MovementsLedger, type MovementType } from "./movements";
import { submitArchivoPin } from "./pin-actions";
import { hasArchivoPinAccess } from "./pin-config";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    month?: string;
    vista?: string;
    metodo?: string;
    tipo?: string;
  }>;
};

type DayRow = {
  day: string;
  sales: number;
  totals: DayTotals;
  closing: CashClosingRow | null;
};

/**
 * Archivo de cajas del mes, en dos vistas:
 *   · Por día: ventas del día (turnos de ese día) y, aparte, el dinero que
 *     entró ese día (efectivo / transferencias / otros) con su cierre.
 *   · Movimientos: cada peso que entró, para rastrearlo contra el banco y el
 *     cajón.
 * Arriba, los controles: lo que debería estar y no está.
 */
export default async function CajaArchivoPage({ searchParams }: Props) {
  await requireRole(["owner", "receptionist"]);

  // Con PIN, como Finanzas: el historial de cajas y las diferencias de cierre
  // no son para cualquiera que tenga la sesión abierta en el mostrador.
  if (!(await hasArchivoPinAccess())) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/caja">
            <ArrowLeft className="size-4" />
            Volver a la caja
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Archivo de cajas
        </h1>
        <PinGate title="Archivo bloqueado" submit={submitArchivoPin} />
      </div>
    );
  }

  const params = await searchParams;
  const today = todayDateStr();
  const month =
    params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : today.slice(0, 7);
  const view = params.vista === "movimientos" ? "movimientos" : "dias";
  const method: MethodGroup | "all" =
    params.metodo === "cash" ||
    params.metodo === "transfer" ||
    params.metodo === "other"
      ? params.metodo
      : "all";
  const type: MovementType =
    params.tipo === "deposit" || params.tipo === "charge" ? params.tipo : "all";
  const { firstDay, lastDay } = monthBounds(`${month}-01`);

  const supabase = await createClient();

  // Sólo el total de egresos en efectivo de cada caja (sin detalle): es lo
  // que hace falta para saber cuánto efectivo tendría que haber.
  const [paymentsResult, salesResult, expensesResult, closingsResult] =
    await Promise.all([
      fetchMonthPayments(supabase, firstDay, lastDay),
      fetchMonthSales(supabase, firstDay, lastDay),
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

  for (const [label, error] of [
    ["payments", paymentsResult.error],
    ["sales", salesResult.error],
    ["expenses", expensesResult.error?.message ?? null],
    ["closings", closingsResult.error?.message ?? null],
  ] as const) {
    if (error) console.error(`[caja/archivo] ${label} query failed:`, error);
  }
  const loadError =
    paymentsResult.error ??
    salesResult.error ??
    expensesResult.error?.message ??
    closingsResult.error?.message ??
    null;

  const payments = paymentsResult.rows;

  const cashExpensesByDay = new Map<string, number>();
  for (const e of expensesResult.data ?? []) {
    if (!e.cash_source_date) continue;
    cashExpensesByDay.set(
      e.cash_source_date,
      (cashExpensesByDay.get(e.cash_source_date) ?? 0) + Number(e.amount),
    );
  }

  const paymentsByDay = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = paymentsByDay.get(p.caja_date) ?? [];
    list.push(p);
    paymentsByDay.set(p.caja_date, list);
  }

  // La venta es del día del turno (en hora de Córdoba).
  const salesByDay = new Map<string, number>();
  for (const a of salesResult.rows) {
    const day = formatInTimeZone(a.starts_at, ZENNA_TZ, "yyyy-MM-dd");
    const total = a.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    salesByDay.set(day, (salesByDay.get(day) ?? 0) + total);
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
      ...salesByDay.keys(),
      ...cashExpensesByDay.keys(),
      ...closings.keys(),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const rows: DayRow[] = days.map((day) => ({
    day,
    sales: salesByDay.get(day) ?? 0,
    totals: computeDayTotals(
      paymentsByDay.get(day) ?? [],
      cashExpensesByDay.get(day) ?? 0,
    ),
    closing: closings.get(day) ?? null,
  }));

  const sum = (pick: (t: DayTotals) => number) =>
    rows.reduce((acc, r) => acc + pick(r.totals), 0);
  const salesTotal = rows.reduce((acc, r) => acc + r.sales, 0);
  const diffTotal = rows.reduce(
    (acc, r) =>
      r.closing
        ? acc + Number(r.closing.counted_cash) - Number(r.closing.expected_cash)
        : acc,
    0,
  );
  const openCashDays = rows
    .filter((r) => !r.closing && r.day < today && r.totals.cash > 0)
    .map((r) => r.day);

  const viewHref = (v: "dias" | "movimientos") =>
    v === "dias"
      ? `/caja/archivo?month=${month}`
      : `/caja/archivo?month=${month}&vista=movimientos`;

  return (
    <div className="space-y-8 max-w-6xl">
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
              Las ventas de cada día, el dinero que entró y los cierres.
            </p>
          </div>
          <MonthNav
            month={month}
            basePath="/caja/archivo"
            extraParams={view === "movimientos" ? "vista=movimientos" : ""}
          />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">
            No pudimos cargar todo el mes: los números de abajo pueden estar
            incompletos.
          </p>
          <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
            {loadError}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          label="Ventas del mes"
          value={formatCurrency(salesTotal)}
          hint="Turnos cobrados, por día del turno"
        />
        <Stat
          label="Efectivo que entró"
          value={formatCurrency(sum((t) => t.cash))}
        />
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
        />
      </div>

      <CajaControls
        firstDay={firstDay}
        lastDay={lastDay}
        today={today}
        openCashDays={openCashDays}
      />

      <section className="space-y-3">
        <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
          {(
            [
              { value: "dias", label: "Por día" },
              { value: "movimientos", label: "Movimientos" },
            ] as const
          ).map((v) => (
            <Link
              key={v.value}
              href={viewHref(v.value)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-[5px] transition-colors",
                view === v.value
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </Link>
          ))}
        </div>

        {view === "movimientos" ? (
          <MovementsLedger
            payments={payments}
            month={month}
            method={method}
            type={type}
          />
        ) : (
          <DaysTable
            rows={rows}
            today={today}
            salesTotal={salesTotal}
            sum={sum}
            diffTotal={diffTotal}
          />
        )}
      </section>
    </div>
  );
}

function DaysTable({
  rows,
  today,
  salesTotal,
  sum,
  diffTotal,
}: {
  rows: DayRow[];
  today: string;
  salesTotal: number;
  sum: (pick: (t: DayTotals) => number) => number;
  diffTotal: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No hay movimientos en este mes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>Día</TableHead>
              <TableHead rowSpan={2} className="text-right border-r">
                Ventas
              </TableHead>
              <TableHead
                colSpan={5}
                className="text-center border-r h-8 text-xs uppercase tracking-wider"
              >
                Efectivo
              </TableHead>
              <TableHead
                colSpan={2}
                className="text-center h-8 text-xs uppercase tracking-wider"
              >
                Otros medios
              </TableHead>
              <TableHead rowSpan={2}>Caja</TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="text-right">Entró</TableHead>
              <TableHead className="text-right">Egresos</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead className="text-right">Contado</TableHead>
              <TableHead className="text-right border-r">Diferencia</TableHead>
              <TableHead className="text-right">Transferencias</TableHead>
              <TableHead className="text-right">Tarjetas y otros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ day, sales, totals, closing }) => {
              const diff = closing
                ? Number(closing.counted_cash) - Number(closing.expected_cash)
                : null;
              const changed =
                closing &&
                Math.abs(Number(closing.expected_cash) - totals.expectedCash) >=
                  0.01;
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
                        entraron señas por {formatCurrency(totals.deposits)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium border-r">
                    {sales > 0 ? formatCurrency(sales) : "—"}
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
                    className={`text-right tabular-nums font-medium border-r ${diff !== null ? diffClass(diff) : ""}`}
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
              <TableCell className="text-right tabular-nums border-r">
                {formatCurrency(salesTotal)}
              </TableCell>
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
                className={`text-right tabular-nums border-r ${diffClass(diffTotal)}`}
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
      <p className="text-xs text-muted-foreground">
        Ventas = turnos de ese día ya cobrados (seña + cobro al atender). Lo que
        entró = plata que llegó ese día, incluidas las señas de turnos de otros
        días. Por eso las dos columnas no tienen por qué coincidir.
      </p>
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
