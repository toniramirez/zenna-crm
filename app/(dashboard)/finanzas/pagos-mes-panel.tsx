import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BillCard } from "./bill-card";
import { MonthNav } from "./month-nav";
import type { ExpenseRow, ExpenseTemplateRow } from "./types";

export function PagosMesPanel({
  month,
  templates,
  paymentsForMonth,
}: {
  month: string; // YYYY-MM
  templates: ExpenseTemplateRow[];
  paymentsForMonth: ExpenseRow[];
}) {
  const period = `${month}-01`;
  const paymentByTemplate = new Map<string, ExpenseRow>();
  for (const p of paymentsForMonth) {
    if (p.template_id) paymentByTemplate.set(p.template_id, p);
  }

  const activeTemplates = templates.filter((t) => t.active);

  // Status calculations
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m] = month.split("-").map(Number);

  let paidAmount = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let overdueCount = 0;
  let projectedTotal = 0;

  for (const t of activeTemplates) {
    const dueDate = new Date(y, m - 1, t.due_day);
    const existing = paymentByTemplate.get(t.id);
    if (existing) {
      paidAmount += Number(existing.amount);
      paidCount++;
      projectedTotal += Number(existing.amount);
    } else {
      projectedTotal += t.default_amount ? Number(t.default_amount) : 0;
      if (today > dueDate) overdueCount++;
      else pendingCount++;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center md:justify-start">
        <MonthNav month={month} extraParams="tab=pagos-mes" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total del mes"
          value={formatCurrency(projectedTotal)}
          hint={`${activeTemplates.length} gasto${activeTemplates.length === 1 ? "" : "s"}`}
          icon={<Receipt className="size-4 text-muted-foreground" />}
        />
        <KpiCard
          label="Pagado"
          value={formatCurrency(paidAmount)}
          hint={`${paidCount} de ${activeTemplates.length}`}
          icon={<CheckCircle2 className="size-4 text-emerald-600" />}
          accent="emerald"
        />
        <KpiCard
          label="Pendiente"
          value={`${pendingCount}`}
          hint="sin pagar"
          icon={<Clock className="size-4 text-amber-600" />}
          accent="amber"
        />
        <KpiCard
          label="Vencido"
          value={`${overdueCount}`}
          hint="vencidos"
          icon={<AlertTriangle className="size-4 text-rose-600" />}
          accent="rose"
        />
      </div>

      {activeTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
          <p className="text-base font-medium">
            Sin plantillas activas todavía
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Andá al tab <strong>Catálogo</strong> y cargá los gastos fijos del
            local para que aparezcan acá cada mes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {activeTemplates.map((t) => (
            <BillCard
              key={t.id}
              template={t}
              period={period}
              existing={paymentByTemplate.get(t.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  accent?: "emerald" | "amber" | "rose";
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          accent === "emerald" && "text-emerald-700",
          accent === "amber" && "text-amber-700",
          accent === "rose" && "text-rose-700",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}
