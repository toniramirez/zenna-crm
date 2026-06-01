import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Crown,
  Scissors,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import { MonthNav } from "./month-nav";
import type { MonthStats } from "./stats";

function PctBadge({ pct, inverted = false }: { pct: number; inverted?: boolean }) {
  if (!Number.isFinite(pct)) return null;
  const isUp = pct >= 0;
  // "inverted" = lower is better (e.g., egresos)
  const good = inverted ? !isUp : isUp;
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
      )}
    >
      <Icon className="size-2.5" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function EstadisticasPanel({
  month,
  stats,
}: {
  month: string;
  stats: MonthStats;
}) {
  const ingresosPct = pctChange(stats.ingresosMonth, stats.ingresosPrev);
  const egresosPct = pctChange(stats.egresosMonth, stats.egresosPrev);
  const comisionesPct = pctChange(
    stats.comisionesBrutasMonth,
    stats.comisionesBrutasPrev,
  );
  const netoPct = pctChange(stats.netoMonth, stats.netoPrev);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center md:justify-start">
        <MonthNav month={month} extraParams="tab=estadisticas" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ArrowUpRight className="size-3.5 text-emerald-600" />
            Ingresos del mes
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {formatCurrency(stats.ingresosMonth)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Vs. mes anterior {formatCurrency(stats.ingresosPrev)}</span>
            <PctBadge pct={ingresosPct} />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ArrowDownRight className="size-3.5 text-rose-600" />
            Egresos del mes
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-rose-700">
            −{formatCurrency(stats.egresosMonth)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Vs. mes anterior {formatCurrency(stats.egresosPrev)}</span>
            <PctBadge pct={egresosPct} inverted />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Scissors className="size-3.5 text-rose-600" />
            Comisiones brutas
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-rose-700">
            −{formatCurrency(stats.comisionesBrutasMonth)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Vs. mes anterior {formatCurrency(stats.comisionesBrutasPrev)}
            </span>
            <PctBadge pct={comisionesPct} inverted />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-3.5 text-gold" />
            Resultado neto
          </div>
          <div
            className={cn(
              "mt-2 text-3xl font-semibold tabular-nums",
              stats.netoMonth >= 0 ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {formatCurrency(stats.netoMonth)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Vs. mes anterior {formatCurrency(stats.netoPrev)}</span>
            <PctBadge pct={netoPct} />
          </div>
        </div>
      </div>

      {/* Arqueo de caja — efectivo a contar */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Wallet className="size-3.5 text-gold" />
          Efectivo en caja · para contar
        </div>
        <div className="mt-3 max-w-md space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Cobrado en efectivo{" "}
              <span className="text-xs tabular-nums">
                ({stats.cashIncomeCount} cobro
                {stats.cashIncomeCount === 1 ? "" : "s"})
              </span>
            </span>
            <span className="tabular-nums font-medium text-emerald-700">
              +{formatCurrency(stats.cashIncomeMonth)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Egresos en efectivo{" "}
              <span className="text-xs tabular-nums">
                ({stats.cashExpensesCount} egreso
                {stats.cashExpensesCount === 1 ? "" : "s"})
              </span>
            </span>
            <span className="tabular-nums font-medium text-rose-700">
              −{formatCurrency(stats.cashExpensesMonth)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-2">
            <span className="font-semibold">Efectivo esperado</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatCurrency(stats.cashIncomeMonth - stats.cashExpensesMonth)}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Lo que debería haber físicamente juntando todo el efectivo del mes
          (cobros en efectivo menos egresos pagados en efectivo, incluidas
          comisiones/sueldos pagados en efectivo). Contá la caja y comparalo
          con este número.
        </p>
      </div>

      {/* Detail row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top servicios */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Servicios más vendidos
          </h3>
          {stats.topServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin datos este mes.
            </p>
          ) : (
            <ul className="space-y-2">
              {stats.topServices.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground tabular-nums w-5">
                      {i + 1}.
                    </span>
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ×{s.count}
                    </span>
                  </div>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(s.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Productividad por profesional */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Productividad
          </h3>
          {stats.byProfessional.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin turnos completados este mes.
            </p>
          ) : (
            <ul className="space-y-2">
              {stats.byProfessional.map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground tabular-nums w-5">
                      {i + 1}.
                    </span>
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ×{p.appointments}
                    </span>
                  </div>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(p.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top categorías de egresos */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Egresos por categoría
          </h3>
          {stats.expensesByCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin egresos este mes.
            </p>
          ) : (
            <ul className="space-y-2">
              {stats.expensesByCategory.map((c) => (
                <li
                  key={c.category}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium">
                    {EXPENSE_CATEGORY_LABEL[c.category]}
                  </span>
                  <span className="tabular-nums text-rose-700">
                    −{formatCurrency(c.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Top clientas — full width */}
      {stats.topClients.length > 0 ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Crown className="size-3.5 text-gold" />
            Clientas top del mes
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
            {stats.topClients.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground tabular-nums w-5">
                    {i + 1}.
                  </span>
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ×{c.visits}
                  </span>
                </div>
                <span className="tabular-nums font-medium">
                  {formatCurrency(c.spent)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Datos de{" "}
        <strong className="capitalize-first">
          {format(stats.monthDate, "MMMM yyyy", { locale: es })}
        </strong>{" "}
        · ingresos basados en cobros registrados, egresos del mes completo
        (incluye gastos fijos). El resultado neto descuenta las comisiones
        brutas adeudadas aunque todavía no estén pagadas.
      </p>
    </div>
  );
}

function pctChange(current: number, prev: number): number {
  if (prev === 0) {
    if (current === 0) return 0;
    return Infinity;
  }
  return ((current - prev) / Math.abs(prev)) * 100;
}
