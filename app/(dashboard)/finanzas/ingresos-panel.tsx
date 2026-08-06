import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  Banknote,
  CreditCard,
  Landmark,
  Smartphone,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/validations/payments";
import {
  HEADLINE_METHODS,
  type IncomeBasis,
  type MethodBreakdown,
  type MonthIncomeReport,
} from "./income-by-method";
import { MonthNav } from "./month-nav";
import { PrintReportButton } from "./print-button";

/** Clases completas (no interpoladas) para que Tailwind las conserve. */
const METHOD_STYLE: Record<
  PaymentMethod,
  { icon: ComponentType<{ className?: string }>; text: string; bar: string; dot: string }
> = {
  cash: {
    icon: Banknote,
    text: "text-emerald-700",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  transfer: {
    icon: Landmark,
    text: "text-sky-700",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
  },
  mp: {
    icon: Smartphone,
    text: "text-cyan-700",
    bar: "bg-cyan-500",
    dot: "bg-cyan-500",
  },
  debit_card: {
    icon: CreditCard,
    text: "text-violet-700",
    bar: "bg-violet-500",
    dot: "bg-violet-500",
  },
  credit_card: {
    icon: CreditCard,
    text: "text-amber-700",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  other: {
    icon: Wallet,
    text: "text-slate-700",
    bar: "bg-slate-400",
    dot: "bg-slate-400",
  },
};

function dayLabel(dateStr: string) {
  return format(parseISO(dateStr + "T12:00:00"), "EEE d", { locale: es });
}

function BasisToggle({
  month,
  basis,
}: {
  month: string;
  basis: IncomeBasis;
}) {
  const options: { value: IncomeBasis; label: string }[] = [
    { value: "pago", label: "Fecha de cobro" },
    { value: "turno", label: "Fecha del turno" },
  ];
  return (
    <div className="inline-flex items-center rounded-lg border bg-muted/30 p-[3px] text-sm">
      {options.map((o) => (
        <Link
          key={o.value}
          href={`/finanzas?month=${month}&tab=ingresos&base=${o.value}`}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors",
            basis === o.value
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function MethodCard({
  method,
  label,
  amount,
  count,
  pct,
  featured,
}: {
  method: PaymentMethod;
  label: string;
  amount: number;
  count: number;
  pct: number;
  featured: boolean;
}) {
  const style = METHOD_STYLE[method];
  const Icon = style.icon;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm",
        featured ? "" : "bg-muted/20",
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={cn("size-3.5", style.text)} />
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-semibold tabular-nums",
          featured ? "text-3xl" : "text-xl",
        )}
      >
        {formatCurrency(amount)}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", style.bar)}
          style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>{pct.toFixed(1)}% del total</span>
        <span>
          {count} cobro{count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function BreakdownSection({
  breakdown,
  basis,
}: {
  breakdown: MethodBreakdown;
  basis: IncomeBasis;
}) {
  const style = METHOD_STYLE[breakdown.method];
  const Icon = style.icon;
  return (
    <details className="group rounded-xl border bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("size-4 shrink-0", style.text)} />
          <span className="font-semibold">{breakdown.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {breakdown.count} cobro{breakdown.count === 1 ? "" : "s"} · prom.{" "}
            {formatCurrency(breakdown.average)}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(breakdown.amount)}
          </span>
          <span className="print-hide text-xs text-muted-foreground group-open:hidden">
            Ver detalle
          </span>
          <span className="print-hide hidden text-xs text-muted-foreground group-open:inline">
            Ocultar
          </span>
        </div>
      </summary>

      <div className="border-t px-5 py-4 space-y-4">
        {breakdown.byProfessional.length > 0 ? (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Por profesional
            </h4>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
              {breakdown.byProfessional.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ×{p.count}
                    </span>
                  </div>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Cobro por cobro
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">
                    Fecha
                  </th>
                  <th className="py-2 pr-3 font-medium">Clienta</th>
                  <th className="py-2 pr-3 font-medium">Profesional</th>
                  <th className="py-2 pr-3 font-medium">Servicios</th>
                  <th className="py-2 text-right font-medium whitespace-nowrap">
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.payments.map((p) => {
                  const shownDay =
                    basis === "turno" ? (p.appointmentDay ?? p.paidDay) : p.paidDay;
                  const mismatched =
                    p.appointmentDay !== null && p.appointmentDay !== p.paidDay;
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                        {format(parseISO(shownDay + "T12:00:00"), "dd/MM", {
                          locale: es,
                        })}
                        {basis === "pago" ? (
                          <span className="text-muted-foreground"> {p.paidTime}</span>
                        ) : null}
                        {mismatched ? (
                          <div className="text-[10px] text-muted-foreground">
                            {basis === "pago" ? "turno" : "cobro"}{" "}
                            {format(
                              parseISO(
                                (basis === "pago"
                                  ? p.appointmentDay!
                                  : p.paidDay) + "T12:00:00",
                              ),
                              "dd/MM",
                              { locale: es },
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{p.clientName}</td>
                      <td className="py-2 pr-3">
                        {p.professionalName ? (
                          <span className="inline-flex items-center gap-1.5">
                            {p.professionalColor ? (
                              <span
                                className="size-2 rounded-full shrink-0"
                                style={{ backgroundColor: p.professionalColor }}
                              />
                            ) : null}
                            {p.professionalName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {p.services.length > 0 ? p.services.join(", ") : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium whitespace-nowrap">
                        {formatCurrency(p.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={4} className="py-2 font-semibold">
                    Total {breakdown.label}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(breakdown.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </details>
  );
}

export function IngresosPanel({
  month,
  report,
}: {
  month: string;
  report: MonthIncomeReport;
}) {
  const monthLabel = format(parseISO(month + "-01T12:00:00"), "MMMM yyyy", {
    locale: es,
  });

  const headline = report.byMethod.filter((m) =>
    HEADLINE_METHODS.includes(m.method),
  );
  const rest = report.byMethod.filter(
    (m) => !HEADLINE_METHODS.includes(m.method),
  );
  const restTotal = rest.reduce((acc, m) => acc + m.amount, 0);

  // Columnas de la tabla diaria: efectivo / transferencia / MP siempre, y
  // "Otros" sólo si hubo movimiento por fuera de esos tres.
  const showOthersColumn = rest.length > 0;

  return (
    <div className="print-report space-y-6">
      {/* Encabezado que sólo aparece en el PDF impreso */}
      <div className="hidden print:block border-b pb-3 mb-2">
        <h1 className="text-xl font-semibold">Reporte de ingresos</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {monthLabel} ·{" "}
          {report.basis === "pago" ? "por fecha de cobro" : "por fecha del turno"}
        </p>
      </div>

      <div className="print-hide flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} extraParams={`tab=ingresos&base=${report.basis}`} />
        <div className="flex items-center gap-2">
          <BasisToggle month={month} basis={report.basis} />
          <PrintReportButton />
        </div>
      </div>

      {report.count === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            No hay cobros registrados en {monthLabel}.
          </p>
        </div>
      ) : (
        <>
          {/* Total del mes */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Wallet className="size-3.5 text-gold" />
              Total ingresado ·{" "}
              <span className="first-letter:uppercase">{monthLabel}</span>
            </div>
            <div className="mt-2 text-4xl font-semibold tabular-nums">
              {formatCurrency(report.total)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {report.count} cobro{report.count === 1 ? "" : "s"} ·{" "}
              {report.byDay.length} día{report.byDay.length === 1 ? "" : "s"} con
              movimiento · promedio {formatCurrency(report.total / report.count)}{" "}
              por cobro
            </div>
            {/* Barra proporcional del mes entero */}
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {report.byMethod.map((m) => (
                <div
                  key={m.method}
                  className={METHOD_STYLE[m.method].bar}
                  style={{ width: `${m.pct}%` }}
                  title={`${m.label} ${m.pct.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {report.byMethod.map((m) => (
                <span key={m.method} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      METHOD_STYLE[m.method].dot,
                    )}
                  />
                  {m.label} {m.pct.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>

          {/* Efectivo · Transferencia · MercadoPago */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HEADLINE_METHODS.map((method) => {
              const m = headline.find((h) => h.method === method);
              return (
                <MethodCard
                  key={method}
                  method={method}
                  label={
                    method === "cash"
                      ? "Efectivo"
                      : method === "transfer"
                        ? "Transferencia"
                        : "MercadoPago"
                  }
                  amount={m?.amount ?? 0}
                  count={m?.count ?? 0}
                  pct={m?.pct ?? 0}
                  featured
                />
              );
            })}
          </div>

          {/* Otros métodos, si hubo */}
          {rest.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {rest.map((m) => (
                <MethodCard
                  key={m.method}
                  method={m.method}
                  label={m.label}
                  amount={m.amount}
                  count={m.count}
                  pct={m.pct}
                  featured={false}
                />
              ))}
            </div>
          ) : null}

          {/* Día a día */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Día a día
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 text-left font-medium">Día</th>
                    <th className="py-2 pr-3 text-right font-medium">Efectivo</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Transferencia
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      MercadoPago
                    </th>
                    {showOthersColumn ? (
                      <th className="py-2 pr-3 text-right font-medium">Otros</th>
                    ) : null}
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byDay.map((d) => {
                    const others =
                      d.byMethod.debit_card +
                      d.byMethod.credit_card +
                      d.byMethod.other;
                    return (
                      <tr key={d.date} className="border-b last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap first-letter:uppercase">
                          {dayLabel(d.date)}
                        </td>
                        <Amount value={d.byMethod.cash} />
                        <Amount value={d.byMethod.transfer} />
                        <Amount value={d.byMethod.mp} />
                        {showOthersColumn ? <Amount value={others} /> : null}
                        <td className="py-2 text-right tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(d.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(
                        report.byMethod.find((m) => m.method === "cash")?.amount ??
                          0,
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(
                        report.byMethod.find((m) => m.method === "transfer")
                          ?.amount ?? 0,
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(
                        report.byMethod.find((m) => m.method === "mp")?.amount ?? 0,
                      )}
                    </td>
                    {showOthersColumn ? (
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(restTotal)}
                      </td>
                    ) : null}
                    <td className="py-2 text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(report.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Desglose por método */}
          <section className="print-break space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Desglose por método
            </h3>
            {report.breakdowns.map((b) => (
              <BreakdownSection key={b.method} breakdown={b} basis={report.basis} />
            ))}
          </section>

          {report.largest ? (
            <p className="text-xs text-muted-foreground">
              Cobro más alto del mes: {formatCurrency(report.largest.amount)} ·{" "}
              {report.largest.clientName} ·{" "}
              {format(parseISO(report.largest.paidDay + "T12:00:00"), "dd/MM", {
                locale: es,
              })}
              .
            </p>
          ) : null}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {report.basis === "pago"
          ? "Los cobros se imputan al mes por su fecha de cobro (paid_at) — el mismo criterio que “Ingresos del mes” en Estadísticas."
          : "Los cobros se imputan al mes por la fecha del turno — el mismo criterio que usa la Caja diaria."}{" "}
        Fechas en horario de Córdoba. Son ingresos brutos: no descuentan
        comisiones, egresos ni recargos de tarjeta.
      </p>
    </div>
  );
}

function Amount({ value }: { value: number }) {
  return (
    <td
      className={cn(
        "py-2 pr-3 text-right tabular-nums whitespace-nowrap",
        value === 0 ? "text-muted-foreground/40" : "",
      )}
    >
      {value === 0 ? "—" : formatCurrency(value)}
    </td>
  );
}
