import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  monthToPeriod,
  safeMonth,
} from "@/lib/validations/expense-templates";
import { EstadisticasPanel } from "./estadisticas-panel";
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
      <div className="space-y-6 max-w-6xl">
        <h1 className="text-2xl font-semibold tracking-tight">Finanzas</h1>
        <PinGate />
      </div>
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

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="print-hide text-2xl font-semibold tracking-tight">
        Finanzas
      </h1>

      <Tabs defaultValue={initialTab} className="space-y-4">
        <TabsList className="print-hide">
          <TabsTrigger value="estadisticas">Estadísticas</TabsTrigger>
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="gastos-fijos">Gastos fijos</TabsTrigger>
          <TabsTrigger value="profesionales">Profesionales</TabsTrigger>
        </TabsList>

        <TabsContent value="estadisticas" className="space-y-4">
          <EstadisticasPanel month={selectedMonth} stats={stats} />
        </TabsContent>

        <TabsContent value="ingresos" className="space-y-4">
          <IngresosPanel month={selectedMonth} report={incomeReport} />
        </TabsContent>

        <TabsContent value="gastos-fijos" className="space-y-4">
          <GastosFijosPanel
            month={selectedMonth}
            templates={templates}
            paymentsForMonth={paymentsForMonth}
          />
        </TabsContent>

        <TabsContent value="profesionales" className="space-y-4">
          <ProfesionalesPanel
            month={selectedMonth}
            period={period}
            snapshot={professionalPayouts}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
