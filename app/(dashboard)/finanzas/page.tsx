import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  monthToPeriod,
  safeMonth,
} from "@/lib/validations/expense-templates";
import { EstadisticasPanel } from "./estadisticas-panel";
import { FinanzasLockedScreen, FinanzasScreen } from "./finanzas-screen";
import { GastosFijosPanel } from "./gastos-fijos-panel";
import { loadMonthIncome, safeBasis } from "./income-by-method";
import { IngresosPanel } from "./ingresos-panel";
import { PinGate } from "./pin-gate";
import { hasFinanzasPinAccess } from "./pin-config";
import { ProfesionalesPanel } from "./profesionales-panel";
import { loadProfessionalPayouts } from "./professional-payouts";
import { loadMonthStats } from "./stats";
import type { ExpenseRow, ExpenseTemplateRow } from "./types";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ tab?: string; month?: string; base?: string }>;
};

const VALID_TABS = [
  "estadisticas",
  "ingresos",
  "gastos-fijos",
  "profesionales",
] as const;
type ValidTab = (typeof VALID_TABS)[number];

export default async function FinanzasPage({ searchParams }: Props) {
  await requireRole("owner");

  if (!(await hasFinanzasPinAccess())) {
    return (
      <FinanzasLockedScreen>
        <PinGate />
      </FinanzasLockedScreen>
    );
  }

  const { tab, month, base } = await searchParams;

  const initialTab: ValidTab = (VALID_TABS as readonly string[]).includes(
    tab ?? "",
  )
    ? (tab as ValidTab)
    : "gastos-fijos";
  const selectedMonth = safeMonth(month);
  const period = monthToPeriod(selectedMonth);
  const incomeBasis = safeBasis(base);

  const supabase = await createClient();
  const statsMonth = new Date(
    Number(selectedMonth.slice(0, 4)),
    Number(selectedMonth.slice(5, 7)) - 1,
    1,
  );

  const [
    stats,
    templatesResult,
    paymentsResult,
    professionalPayouts,
    incomeReport,
  ] = await Promise.all([
    loadMonthStats(statsMonth),
    supabase
      .from("expense_templates")
      .select("*")
      .order("active", { ascending: false })
      .order("name"),
    supabase
      .from("expenses")
      .select("*")
      .eq("period", period)
      .not("template_id", "is", null),
    loadProfessionalPayouts(period),
    loadMonthIncome(selectedMonth, incomeBasis),
  ]);

  const templates =
    (templatesResult.data as ExpenseTemplateRow[] | null) ?? [];
  const paymentsForMonth =
    (paymentsResult.data as ExpenseRow[] | null) ?? [];

  // Título, solapas y —en el teléfono— el encabezado con el mes los arma
  // `FinanzasScreen`; los paneles son los mismos en las dos pantallas.
  return (
    <FinanzasScreen
      month={selectedMonth}
      initialTab={initialTab}
      basis={incomeBasis}
      panels={{
        estadisticas: <EstadisticasPanel month={selectedMonth} stats={stats} />,
        ingresos: <IngresosPanel month={selectedMonth} report={incomeReport} />,
        "gastos-fijos": (
          <GastosFijosPanel
            month={selectedMonth}
            templates={templates}
            paymentsForMonth={paymentsForMonth}
          />
        ),
        profesionales: (
          <ProfesionalesPanel
            month={selectedMonth}
            period={period}
            snapshot={professionalPayouts}
          />
        ),
      }}
    />
  );
}
