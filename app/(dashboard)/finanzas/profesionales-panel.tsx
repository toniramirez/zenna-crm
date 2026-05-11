import { TrendingUp, Users, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthNav } from "./month-nav";
import { ProfessionalPayoutCard } from "./professional-payout-card";
import type { ProfessionalPayoutsSnapshot } from "./professional-payouts";

export function ProfesionalesPanel({
  month,
  period,
  snapshot,
}: {
  month: string; // YYYY-MM
  period: string; // YYYY-MM-01
  snapshot: ProfessionalPayoutsSnapshot;
}) {
  const { payouts, salonNet, ingresos, egresosExclPayouts, totalGrossOwed } =
    snapshot;

  let totalDueRemaining = 0;
  let paidCount = 0;
  for (const p of payouts) {
    if (p.existingPayment) {
      paidCount++;
    } else {
      totalDueRemaining += p.totalDue;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center md:justify-start">
        <MonthNav month={month} extraParams="tab=profesionales" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Profesionales"
          value={`${payouts.length}`}
          hint="activas"
          icon={<Users className="size-4 text-muted-foreground" />}
        />
        <KpiCard
          label="Neto del salón"
          value={formatCurrency(salonNet)}
          hint={`${formatCurrency(ingresos)} − ${formatCurrency(egresosExclPayouts)} egresos − ${formatCurrency(totalGrossOwed)} brutos`}
          icon={<TrendingUp className="size-4 text-muted-foreground" />}
          accent={salonNet < 0 ? "rose" : undefined}
        />
        <KpiCard
          label="A pagar"
          value={formatCurrency(totalDueRemaining)}
          hint={`${payouts.length - paidCount} pendiente${payouts.length - paidCount === 1 ? "" : "s"}`}
          icon={<Wallet className="size-4 text-amber-600" />}
          accent="amber"
        />
        <KpiCard
          label="Pagado"
          value={`${paidCount} de ${payouts.length}`}
          hint="profesionales liquidadas"
          icon={<Wallet className="size-4 text-emerald-600" />}
          accent="emerald"
        />
      </div>

      {payouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
          <p className="text-base font-medium">
            No hay profesionales activas todavía
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Andá a <strong>Profesionales</strong> y cargá al menos una con su
            comisión bruta y neta para verla acá.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {payouts.map((p) => (
            <ProfessionalPayoutCard
              key={p.professional.id}
              payout={p}
              period={period}
              salonNet={salonNet}
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
