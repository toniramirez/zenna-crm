import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { requireRole } from "@/lib/auth";
import {
  dayRangeISO,
  monthBounds,
  safeDateStr,
  todayDateStr,
} from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/validations/payments";
import { CajaDateNav } from "./date-nav";
import { NewExpenseButton } from "./expense-dialog";
import { ExpensesList } from "./expenses-list";
import { PaymentsList } from "./payments-list";
import { CajaSummaryCards } from "./summary-cards";
import type { ExpenseRow, PaymentWithDetails, UnpaidAppointment } from "./types";
import { UnpaidList } from "./unpaid-list";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ date?: string }>;
};

export default async function CajaPage({ searchParams }: Props) {
  const ctx = await requireRole(["owner", "receptionist"]);
  const isOwner = ctx.profile.role === "owner";

  const { date } = await searchParams;
  const selectedDate = safeDateStr(date);
  const today = todayDateStr();
  const isToday = selectedDate === today;

  const { start: dayStart, end: dayEnd } = dayRangeISO(selectedDate);
  const { firstDay, lastDay } = monthBounds(selectedDate);

  const supabase = await createClient();

  // Payments for the selected day — la caja pertenece al día del TURNO (starts_at),
  // no al momento en que se registró el cobro. Así, si la recepcionista carga
  // hoy un servicio de ayer, el cobro aparece en la caja de ayer.
  const paymentsResult = await supabase
    .from("payments")
    .select(
      `
      *,
      appointments!inner (
        id, starts_at, professional_id,
        professionals ( id, full_name, color ),
        clients ( id, full_name ),
        appointment_services ( services ( name ) )
      )
    `,
    )
    .gte("appointments.starts_at", dayStart)
    .lte("appointments.starts_at", dayEnd)
    .order("paid_at", { ascending: false });

  // Expenses for the whole month (only owner — receptionist gets empty)
  const expensesResult = isOwner
    ? await supabase
        .from("expenses")
        .select("*")
        .gte("expense_date", firstDay)
        .lte("expense_date", lastDay)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
    : { data: [] as never[] };

  // Pendientes de cobro del día seleccionado (no sólo hoy): la recepcionista
  // puede pararse en la caja de un día pasado para cobrar un servicio cargado
  // tarde a la agenda.
  //
  // `professionals` va como left join a propósito: con `!inner` cualquier turno
  // cuya profesional no se pueda leer (baja, borrada, o filtrada por RLS)
  // desaparecía de la lista y quedaba sin cobrar. Preferimos mostrarlo con la
  // profesional en "—" antes que perder plata.
  const unpaidResult = await supabase
    .from("appointments")
    .select(
      `
      id, starts_at, ends_at, status, deposit_amount, deposit_method,
      professionals ( id, full_name, color ),
      clients ( id, full_name, phone ),
      appointment_services ( id, professional_id, price_at_booking, duration_at_booking, services ( name ) ),
      payments ( id )
    `,
    )
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .neq("status", "cancelled")
    .neq("status", "no_show")
    .order("starts_at");

  const payments = (paymentsResult.data as PaymentWithDetails[] | null) ?? [];
  const expenses = (expensesResult.data as ExpenseRow[]) ?? [];

  type UnpaidRow = {
    id: string;
    starts_at: string;
    ends_at: string;
    status: UnpaidAppointment["status"];
    deposit_amount: number;
    deposit_method: UnpaidAppointment["deposit_method"];
    professionals: { id: string; full_name: string; color: string } | null;
    clients: { id: string; full_name: string; phone: string | null } | null;
    appointment_services: {
      id: string;
      professional_id: string;
      price_at_booking: number;
      duration_at_booking: number;
      services: { name: string } | null;
    }[];
    payments: { id: string }[];
  };

  const unpaid: UnpaidAppointment[] = (
    (unpaidResult.data as UnpaidRow[] | null) ?? []
  )
    .filter((a) => (a.payments ?? []).length === 0)
    .map((a) => ({
      id: a.id,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      professional: a.professionals,
      client: a.clients,
      services: a.appointment_services.map((s) => ({
        id: s.id,
        name: s.services?.name ?? "Servicio",
        price: Number(s.price_at_booking),
        duration_minutes: s.duration_at_booking,
        professional_id: s.professional_id,
      })),
      total_price: a.appointment_services.reduce(
        (acc, s) => acc + Number(s.price_at_booking),
        0,
      ),
      deposit_amount: Number(a.deposit_amount ?? 0),
      deposit_method: a.deposit_method,
    }));

  // ── Totals
  const totalsByMethod = new Map<string, { amount: number; count: number }>();
  for (const p of payments) {
    const prev = totalsByMethod.get(p.method) ?? { amount: 0, count: 0 };
    totalsByMethod.set(p.method, {
      amount: prev.amount + Number(p.amount),
      count: prev.count + 1,
    });
  }
  const totalIncome = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const cashIncome = totalsByMethod.get("cash")?.amount ?? 0;

  // Cash expenses ATTRIBUTED to this specific day's caja.
  // Only counts when cash_source_date is set — null means the expense isn't
  // tied to any particular till (e.g., fixed-expense payments from templates).
  const cashExpensesForDay = expenses
    .filter(
      (e) =>
        e.payment_method === "cash" && e.cash_source_date === selectedDate,
    )
    .reduce((acc, e) => acc + Number(e.amount), 0);

  const cashToRender = cashIncome - cashExpensesForDay;

  const totalExpensesMonth = expenses.reduce(
    (acc, e) => acc + Number(e.amount),
    0,
  );
  const netResultDay = totalIncome - cashExpensesForDay;

  const monthLabel = format(parseISO(firstDay + "T12:00:00"), "MMMM yyyy", {
    locale: es,
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <CajaDateNav dateStr={selectedDate} />
        </div>
        {isOwner ? <NewExpenseButton defaultDate={selectedDate} /> : null}
      </div>

      {/* Top cards */}
      <CajaSummaryCards
        isOwner={isOwner}
        cashToRender={cashToRender}
        cashIncome={cashIncome}
        cashExpensesForDay={cashExpensesForDay}
        totalIncome={totalIncome}
        paymentsCount={payments.length}
        totalExpensesMonth={totalExpensesMonth}
        netResultDay={netResultDay}
        monthLabel={monthLabel}
      />

      {/* Breakdown by method */}
      {payments.length > 0 ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-3 uppercase tracking-wider text-muted-foreground">
            Por método de pago
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {PAYMENT_METHODS.map((m) => {
              const t = totalsByMethod.get(m.value);
              if (!t) return null;
              return (
                <div key={m.value} className="rounded-md border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABEL[m.value]}
                  </div>
                  <div className="mt-1 text-base font-semibold tabular-nums">
                    {formatCurrency(t.amount)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.count} cobro{t.count === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Pendientes del día seleccionado */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          {isToday ? "Pendientes de cobro hoy" : "Pendientes de cobro del día"}
        </h2>
        <UnpaidList appointments={unpaid} />
      </section>

      {/* Cobros del día */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          {isToday ? "Cobros del día" : `Cobros del día seleccionado`}
        </h2>
        <PaymentsList payments={payments} />
      </section>

      {/* Egresos del mes (owner) */}
      {isOwner ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight capitalize-first">
              Egresos de {monthLabel}
            </h2>
            <span className="text-xs text-muted-foreground">
              Las filas resaltadas afectan el efectivo a rendir de este día.
            </span>
          </div>
          <ExpensesList
            expenses={expenses}
            canDelete
            currentDate={selectedDate}
          />
        </section>
      ) : null}
    </div>
  );
}
