import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { FolderArchive } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth";
import {
  dayRangeISO,
  monthBounds,
  safeDateStr,
  todayDateStr,
} from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CloseCajaCard } from "./close-caja";
import { CajaDateNav } from "./date-nav";
import { computeDayTotals, METHOD_GROUPS, methodGroup } from "./day-totals";
import { NewExpenseButton } from "./expense-dialog";
import { ExpensesList } from "./expenses-list";
import { PaymentsList } from "./payments-list";
import { CajaSummaryCards } from "./summary-cards";
import type {
  CashClosingRow,
  ExpenseRow,
  PaymentWithDetails,
  UnpaidAppointment,
} from "./types";
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

  // Pagos de la caja del día. `caja_date` lo fija la base: un cobro de turno
  // va a la caja del día del TURNO (si la recepcionista carga hoy un servicio
  // de ayer, cae en la caja de ayer) y una seña va a la caja del día en que se
  // cobró, aunque el turno sea otro día.
  const paymentsResult = await supabase
    .from("payments")
    .select(
      `
      *,
      appointments (
        id, starts_at, professional_id,
        professionals ( id, full_name, color ),
        clients ( id, full_name ),
        appointment_services ( services ( name ) )
      )
    `,
    )
    .eq("caja_date", selectedDate)
    .order("paid_at", { ascending: false });

  const closingResult = await supabase
    .from("cash_closings")
    .select("*")
    .eq("caja_date", selectedDate)
    .maybeSingle();

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
      payments ( id, is_deposit )
    `,
    )
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .neq("status", "cancelled")
    .neq("status", "no_show")
    .order("starts_at");

  // Una consulta que falla NO puede renderizarse como "no hay nada". En una caja
  // registradora un empty state mentiroso hace que un turno quede sin cobrar y
  // nadie se entere: preferimos gritar. Lo logueamos con el código de Postgres
  // (aparece en los logs de Railway) y además lo mostramos en pantalla.
  if (unpaidResult.error) {
    console.error("[caja] unpaid query failed:", unpaidResult.error);
  }
  if (paymentsResult.error) {
    console.error("[caja] payments query failed:", paymentsResult.error);
  }
  if (closingResult.error) {
    console.error("[caja] closing query failed:", closingResult.error);
  }

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
    payments: { id: string; is_deposit: boolean }[];
  };

  const totalOf = (a: UnpaidRow) =>
    a.appointment_services.reduce((acc, s) => acc + Number(s.price_at_booking), 0);

  // Pendiente = todavía no se cobró el saldo. La seña no cuenta como cobro;
  // y si la seña cubrió todo el precio no queda nada que cobrar.
  const unpaid: UnpaidAppointment[] = (
    (unpaidResult.data as UnpaidRow[] | null) ?? []
  )
    .filter(
      (a) =>
        !(a.payments ?? []).some((p) => !p.is_deposit) &&
        totalOf(a) - Number(a.deposit_amount ?? 0) > 0,
    )
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
      total_price: totalOf(a),
      deposit_amount: Number(a.deposit_amount ?? 0),
      deposit_method: a.deposit_method,
    }));

  // ── Totals
  // Cash expenses ATTRIBUTED to this specific day's caja.
  // Only counts when cash_source_date is set — null means the expense isn't
  // tied to any particular till (e.g., fixed-expense payments from templates).
  // La recepción no ve el detalle de egresos, pero sí el total que salió del
  // cajón ese día: sin eso el efectivo esperado no le cierra nunca al contar.
  const cashExpensesForDay = (
    isOwner
      ? expenses.filter(
          (e) =>
            e.payment_method === "cash" && e.cash_source_date === selectedDate,
        )
      : ((
          await supabase
            .from("expenses")
            .select("amount")
            .eq("payment_method", "cash")
            .eq("cash_source_date", selectedDate)
        ).data ?? [])
  ).reduce((acc, e) => acc + Number(e.amount), 0);

  const totals = computeDayTotals(payments, cashExpensesForDay);
  const totalIncome = totals.total;
  const cashIncome = totals.cash;
  const cashToRender = totals.expectedCash;
  const closing = (closingResult.data as CashClosingRow | null) ?? null;

  const byGroup = (g: string) => payments.filter((p) => methodGroup(p.method) === g);

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
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/caja/archivo?month=${selectedDate.slice(0, 7)}`}>
              <FolderArchive className="size-4" />
              Archivo de cajas
            </Link>
          </Button>
          {isOwner ? <NewExpenseButton defaultDate={selectedDate} /> : null}
        </div>
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

      {/* Separado por cómo se controla: efectivo en el cajón, transferencias
          en el banco, el resto en sus resúmenes. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {METHOD_GROUPS.map((g) => {
          const amount = totals[g.value];
          const rows = byGroup(g.value);
          const count = rows.length;
          const deposits = rows
            .filter((p) => p.is_deposit)
            .reduce((acc, p) => acc + Number(p.amount), 0);
          return (
            <div key={g.value} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {g.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {count} cobro{count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatCurrency(amount)}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {g.hint}
                {deposits > 0 ? ` · incluye señas ${formatCurrency(deposits)}` : ""}
              </p>
            </div>
          );
        })}
      </div>

      <CloseCajaCard
        cajaDate={selectedDate}
        isOwner={isOwner}
        isFuture={selectedDate > today}
        expectedCash={cashToRender}
        cashIncome={cashIncome}
        cashExpenses={cashExpensesForDay}
        transferIncome={totals.transfer}
        closing={closing}
        loadError={closingResult.error?.message ?? null}
      />

      {/* Pendientes del día seleccionado */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          {isToday ? "Pendientes de cobro hoy" : "Pendientes de cobro del día"}
        </h2>
        <UnpaidList
          appointments={unpaid}
          loadError={unpaidResult.error?.message ?? null}
        />
      </section>

      {/* Cobros del día */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          {isToday ? "Cobros del día" : `Cobros del día seleccionado`}
        </h2>
        {paymentsResult.error ? (
          // Igual que los pendientes: un error no puede verse como "sin cobros".
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
            <p className="text-sm font-medium text-destructive">
              No pudimos cargar los cobros de esta caja.
            </p>
            <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
              {paymentsResult.error.message}
            </p>
          </div>
        ) : (
          <PaymentsList payments={payments} cajaDate={selectedDate} />
        )}
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
