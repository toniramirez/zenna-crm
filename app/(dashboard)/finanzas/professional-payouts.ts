import { createClient } from "@/lib/supabase/server";
import { computeGrossOwed, type ProrrateablePayment } from "./commissions-calc";
import type { ExpenseRow } from "./types";

export type ProfessionalPayout = {
  professional: {
    id: string;
    full_name: string;
    color: string;
    commission_rate: number;
    commission_rate_net: number;
  };
  /** Bruto del mes para esta profesional: porción de los pagos cobrados que
   *  le corresponde por sus servicios, multiplicado por su tasa bruta actual. */
  grossOwed: number;
  /** Base sobre la que se calculó el bruto (suma de los pagos del mes que
   *  pasaron por servicios suyos, ya prorrateada por precio). */
  paymentsAttributed: number;
  /** Porción del neto del salón que le corresponde por su tasa neta. */
  netShare: number;
  /** Total sugerido a pagar (bruto + neto) si no está pagado aún. */
  totalDue: number;
  /** Expense ya cargado para ese período si la profesional ya cobró. */
  existingPayment: ExpenseRow | null;
};

export type ProfessionalPayoutsSnapshot = {
  payouts: ProfessionalPayout[];
  /** Neto total del salón en el mes (ingresos − egresos excl. payouts − bruto total). */
  salonNet: number;
  ingresos: number;
  egresosExclPayouts: number;
  /** Total de bruto adeudado a todas las profesionales del mes (con tasa actual). */
  totalGrossOwed: number;
};

function monthBounds(period: string): { startIso: string; endIso: string } {
  const [y, m] = period.split("-").map(Number);
  return {
    startIso: new Date(y, m - 1, 1).toISOString(),
    endIso: new Date(y, m, 1).toISOString(),
  };
}

function monthDateBounds(period: string): { firstDay: string; lastDay: string } {
  const [y, m] = period.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, m, 0).getDate();
  return {
    firstDay: `${y}-${pad(m)}-01`,
    lastDay: `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}

/**
 * Loads the per-professional payout snapshot for a given period.
 *
 * Bruto se calcula DINÁMICAMENTE sobre los pagos cobrados, no sobre la tabla
 * `commissions` (esa queda como audit log con el snapshot histórico). Para
 * cada pago del mes:
 *   1. Sumamos `price_at_booking` de cada `appointment_services` del turno.
 *   2. La porción del pago que le corresponde a cada profesional =
 *      payment.amount × (suma_de_sus_precios / suma_total_precios).
 *   3. Bruto del mes para la profesional X = Σ porciones × commission_rate_X / 100.
 *
 * Si la profesional cambió su tasa después de cobrar, los pendientes reflejan
 * automáticamente la nueva tasa. La base es el monto pagado por la clienta
 * (incluye propinas/recargos si los hubo).
 *
 * Net share — base = ganancia REAL del salón después de pagar las comisiones brutas:
 *   salon_net   = ingresos_mes
 *               − egresos_mes (excluyendo payouts a profesionales)
 *               − total_bruto_adeudado_del_mes (tasas actuales)
 *   net_share_X = max(0, salon_net) × commission_rate_net_X / 100
 *
 * Restamos el bruto porque ya está comprometido a las profesionales; el 15%
 * neto se aplica sólo sobre lo que efectivamente le queda al salón. Si no lo
 * restáramos, le pagaríamos a la profesional 15% sobre plata que se va a ir
 * a comisiones brutas (de ella misma o de otras).
 */
export async function loadProfessionalPayouts(
  period: string,
): Promise<ProfessionalPayoutsSnapshot> {
  const supabase = await createClient();
  const { startIso, endIso } = monthBounds(period);
  const { firstDay, lastDay } = monthDateBounds(period);

  const [
    professionalsResult,
    paymentsResult,
    expensesResult,
    existingPayoutsResult,
  ] = await Promise.all([
    supabase
      .from("professionals")
      .select("id, full_name, color, commission_rate, commission_rate_net")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("payments")
      .select(
        "amount, appointments ( appointment_services ( professional_id, price_at_booking ) )",
      )
      .gte("paid_at", startIso)
      .lt("paid_at", endIso),
    supabase
      .from("expenses")
      .select("amount, professional_id")
      .gte("expense_date", firstDay)
      .lte("expense_date", lastDay),
    supabase
      .from("expenses")
      .select("*")
      .eq("period", period)
      .not("professional_id", "is", null),
  ]);

  const professionals = professionalsResult.data ?? [];
  const payments = (paymentsResult.data ??
    []) as unknown as ProrrateablePayment[];
  const expenses = expensesResult.data ?? [];
  const existingPayouts = (existingPayoutsResult.data ?? []) as ExpenseRow[];

  const ingresos = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const egresosExclPayouts = expenses.reduce(
    (acc, e) => (e.professional_id ? acc : acc + Number(e.amount)),
    0,
  );

  const { totalGrossOwed, byProfessional: grossByProf } = computeGrossOwed(
    payments,
    professionals.map((p) => ({
      id: p.id,
      commission_rate: Number(p.commission_rate),
    })),
  );

  const existingByProf = new Map<string, ExpenseRow>();
  for (const exp of existingPayouts) {
    if (exp.professional_id) existingByProf.set(exp.professional_id, exp);
  }

  const salonNet = ingresos - egresosExclPayouts - totalGrossOwed;
  const baseForNetShare = Math.max(0, salonNet);

  const payouts: ProfessionalPayout[] = professionals.map((p) => {
    const proGross = grossByProf.get(p.id);
    const attributed = proGross?.paymentsAttributed ?? 0;
    const grossOwed = proGross?.grossOwed ?? 0;
    const rateNet = Number(p.commission_rate_net);
    const netShare =
      Math.round(((baseForNetShare * rateNet) / 100) * 100) / 100;
    return {
      professional: {
        id: p.id,
        full_name: p.full_name,
        color: p.color,
        commission_rate: Number(p.commission_rate),
        commission_rate_net: rateNet,
      },
      grossOwed,
      paymentsAttributed: attributed,
      netShare,
      totalDue: grossOwed + netShare,
      existingPayment: existingByProf.get(p.id) ?? null,
    };
  });

  return {
    payouts,
    salonNet,
    ingresos,
    egresosExclPayouts,
    totalGrossOwed,
  };
}
