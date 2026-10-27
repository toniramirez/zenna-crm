import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { FolderArchive } from "lucide-react";
import Link from "next/link";
import { PhoneOrDesktop } from "@/components/dashboard/phone-screen";
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
import { PhoneCaja } from "./phone-caja";
import { SalesList } from "./sales-list";
import { CajaSummaryCards } from "./summary-cards";
import {
  type AppointmentPayment,
  type CashClosingRow,
  type DayAppointment,
  type ExpenseRow,
  type PaymentWithDetails,
  saleBreakdown,
} from "./types";
import { UnpaidList } from "./unpaid-list";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ date?: string }>;
};

/**
 * La caja de un día tiene dos cosas distintas que no hay que mezclar:
 *
 *   · TURNOS DEL DÍA (las ventas): cada turno de este día, pendiente o
 *     cobrado. La venta es del día del turno: seña + lo cobrado al atender.
 *   · DINERO QUE ENTRÓ (los movimientos): lo que efectivamente entró este
 *     día, separado en efectivo / transferencias / otros. Incluye las señas
 *     que se cobraron hoy para turnos de otros días.
 *
 * Una seña cobrada el 8 para un turno del 20 es un movimiento del 8 y parte
 * de la venta del 20.
 */
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

  // Dinero que entró en esta caja. `caja_date` lo fija la base: una seña va a
  // la caja del día en que se cobró, un cobro va a la caja del día del turno
  // (si se carga tarde un turno de ayer, cae en la caja de ayer).
  const paymentsResult = await supabase
    .from("payments")
    .select(
      `
      *,
      appointments (
        id, starts_at, status, professional_id,
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

  // Turnos del día seleccionado (no sólo hoy): la recepcionista puede pararse
  // en la caja de un día pasado para cobrar un servicio cargado tarde.
  //
  // `professionals` va como left join a propósito: con `!inner` cualquier turno
  // cuya profesional no se pueda leer (baja, borrada, o filtrada por RLS)
  // desaparecía de la lista y quedaba sin cobrar. Preferimos mostrarlo con la
  // profesional en "—" antes que perder plata.
  const dayResult = await supabase
    .from("appointments")
    .select(
      `
      id, starts_at, ends_at, status, charged_at,
      deposit_amount, deposit_method, deposit_paid_on,
      professionals ( id, full_name, color ),
      clients ( id, full_name, phone ),
      appointment_services ( id, professional_id, price_at_booking, duration_at_booking, services ( name ) ),
      payments ( id, amount, method, is_deposit, caja_date, paid_at )
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
  if (dayResult.error) {
    console.error("[caja] day appointments query failed:", dayResult.error);
  }
  if (paymentsResult.error) {
    console.error("[caja] payments query failed:", paymentsResult.error);
  }
  if (closingResult.error) {
    console.error("[caja] closing query failed:", closingResult.error);
  }

  const payments = (paymentsResult.data as PaymentWithDetails[] | null) ?? [];
  const expenses = (expensesResult.data as ExpenseRow[]) ?? [];

  type DayRow = {
    id: string;
    starts_at: string;
    ends_at: string;
    status: DayAppointment["status"];
    charged_at: string | null;
    deposit_amount: number;
    deposit_method: DayAppointment["deposit_method"];
    deposit_paid_on: string | null;
    professionals: { id: string; full_name: string; color: string } | null;
    clients: { id: string; full_name: string; phone: string | null } | null;
    appointment_services: {
      id: string;
      professional_id: string;
      price_at_booking: number;
      duration_at_booking: number;
      services: { name: string } | null;
    }[];
    payments: AppointmentPayment[];
  };

  const dayAppointments: DayAppointment[] = (
    (dayResult.data as DayRow[] | null) ?? []
  ).map((a) => ({
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
    deposit_paid_on: a.deposit_paid_on,
    charged_at: a.charged_at,
    payments: a.payments ?? [],
  }));

  // Pendiente = la venta no se cerró. La seña NO cierra la venta, y el precio
  // de lista tampoco decide nada: la mayoría de los servicios se cotizan al
  // atender (precio $0 en la lista).
  const pending = dayAppointments.filter((a) => !a.charged_at);
  const sales = dayAppointments.filter((a) => a.charged_at);
  const salesTotal = sales.reduce((acc, a) => acc + saleBreakdown(a).total, 0);

  // Cajas ya cerradas entre los pagos de las ventas (la seña puede ser de otro
  // día): ahí la recepción no puede cambiar el método. La base lo hace cumplir
  // igual; esto es para avisarlo antes de que lo intente.
  const saleCajaDates = [
    ...new Set(sales.flatMap((a) => a.payments.map((p) => p.caja_date))),
  ];
  const closedCajaDates =
    saleCajaDates.length > 0
      ? ((
          await supabase
            .from("cash_closings")
            .select("caja_date")
            .in("caja_date", saleCajaDates)
        ).data ?? []).map((c) => c.caja_date)
      : [];

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
  const closing = (closingResult.data as CashClosingRow | null) ?? null;

  const byGroup = (g: string) =>
    payments.filter((p) => methodGroup(p.method) === g);

  // De lo que entró hoy: señas (para turnos de cualquier día) y cobros.
  const depositsIn = payments
    .filter((p) => p.is_deposit)
    .reduce((acc, p) => acc + Number(p.amount), 0);
  const chargesIn = totals.total - depositsIn;

  const totalExpensesMonth = expenses.reduce(
    (acc, e) => acc + Number(e.amount),
    0,
  );
  const netResultDay = totals.total - cashExpensesForDay;

  const monthLabel = format(parseISO(firstDay + "T12:00:00"), "MMMM yyyy", {
    locale: es,
  });

  const desktop = (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
            <CajaDateNav dateStr={selectedDate} />
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/caja/archivo?month=${selectedDate.slice(0, 7)}`}>
                <FolderArchive className="size-4" />
                Archivo y controles
              </Link>
            </Button>
            {isOwner ? <NewExpenseButton defaultDate={selectedDate} /> : null}
          </div>
        </div>

        <CajaSummaryCards
          isOwner={isOwner}
          cashToRender={totals.expectedCash}
          cashIncome={totals.cash}
          cashExpensesForDay={cashExpensesForDay}
          salesTotal={salesTotal}
          salesCount={sales.length}
          pendingCount={pending.length}
          totalExpensesMonth={totalExpensesMonth}
          netResultDay={netResultDay}
          monthLabel={monthLabel}
        />

        <CloseCajaCard
          cajaDate={selectedDate}
          isOwner={isOwner}
          isFuture={selectedDate > today}
          expectedCash={totals.expectedCash}
          cashIncome={totals.cash}
          cashExpenses={cashExpensesForDay}
          transferIncome={totals.transfer}
          closing={closing}
          loadError={closingResult.error?.message ?? null}
        />
      </div>

      {/* ── Turnos del día: las ventas ─────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Turnos {isToday ? "de hoy" : "del día"}
          </h2>
          <p className="text-xs text-muted-foreground">
            La venta queda en el día del turno: seña + lo que se cobra al
            atender.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Pendientes de cobro{" "}
            <span className="font-normal text-muted-foreground">
              · {pending.length}
            </span>
          </h3>
          <UnpaidList
            appointments={pending}
            loadError={dayResult.error?.message ?? null}
          />
        </div>

        {!dayResult.error ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">
              Ventas cerradas{" "}
              <span className="font-normal text-muted-foreground">
                · {formatCurrency(salesTotal)}
              </span>
            </h3>
            <SalesList
              sales={sales}
              isOwner={isOwner}
              closedCajaDates={closedCajaDates}
            />
          </div>
        ) : null}
      </section>

      {/* ── Dinero que entró: los movimientos ──────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Dinero que entró {isToday ? "hoy" : "este día"}{" "}
            <span className="font-normal text-muted-foreground">
              · {formatCurrency(totals.total)}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {depositsIn > 0
              ? `${formatCurrency(depositsIn)} en señas (de turnos de este u otros días) + ${formatCurrency(chargesIn)} en cobros de turnos.`
              : "Cobros de turnos y señas, separados por cómo se controlan."}
          </p>
        </div>

        {/* Separado por cómo se controla: efectivo en el cajón, transferencias
            en el banco, el resto en sus resúmenes. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {METHOD_GROUPS.map((g) => {
            const rows = byGroup(g.value);
            const deposits = rows
              .filter((p) => p.is_deposit)
              .reduce((acc, p) => acc + Number(p.amount), 0);
            return (
              <div
                key={g.value}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {rows.length} mov.
                  </span>
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatCurrency(totals[g.value])}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {g.hint}
                  {deposits > 0
                    ? ` · ${formatCurrency(deposits)} de señas`
                    : ""}
                </p>
              </div>
            );
          })}
        </div>

        {paymentsResult.error ? (
          // Igual que los pendientes: un error no puede verse como "no entró nada".
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
            <p className="text-sm font-medium text-destructive">
              No pudimos cargar los movimientos de esta caja.
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

  // En el teléfono las tablas de arriba no entran: la caja es otra pantalla,
  // con los mismos datos (ver ./phone-caja).
  return (
    <PhoneOrDesktop
      phone={
        <PhoneCaja
          selectedDate={selectedDate}
          today={today}
          isOwner={isOwner}
          totals={totals}
          cashExpensesForDay={cashExpensesForDay}
          salesTotal={salesTotal}
          pending={pending}
          sales={sales}
          closedCajaDates={closedCajaDates}
          payments={paymentsResult.error ? [] : payments}
          expenses={expenses}
          totalExpensesMonth={totalExpensesMonth}
          monthLabel={monthLabel}
          closing={closing}
          errors={{
            day: dayResult.error?.message ?? null,
            payments: paymentsResult.error?.message ?? null,
            closing: closingResult.error?.message ?? null,
          }}
        />
      }
      desktop={desktop}
    />
  );
}
