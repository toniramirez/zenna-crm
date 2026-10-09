import { dayRangeISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/validations/payments";
import type { Database } from "@/types/database.types";

const PAGE_SIZE = 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

/** Un movimiento de dinero del mes, con lo mínimo del turno para rastrearlo. */
export type LedgerPayment = {
  id: string;
  caja_date: string;
  paid_at: string;
  method: PaymentMethod;
  amount: number;
  is_deposit: boolean;
  notes: string | null;
  appointments: {
    id: string;
    starts_at: string;
    status: AppointmentStatus;
    clients: { full_name: string } | null;
    appointment_services: { services: { name: string } | null }[];
  } | null;
};

export type ChargedAppointment = {
  starts_at: string;
  payments: { amount: number }[];
};

/**
 * Pagina de a 1000 porque PostgREST tiene un tope de filas por request y un
 * mes cargado puede pasarlo. Devuelve el error en vez de tirar: la pantalla
 * tiene que poder decir "no pudimos cargar" y no "no hubo nada".
 */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await query(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE - 1,
    );
    if (error) return { rows, error: error.message };
    const batch = (data as T[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null };
  }
}

/** Todos los movimientos de dinero con `caja_date` dentro del mes. */
export function fetchMonthPayments(
  supabase: Supabase,
  firstDay: string,
  lastDay: string,
) {
  return fetchAll<LedgerPayment>((from, to) =>
    supabase
      .from("payments")
      .select(
        `
        id, caja_date, paid_at, method, amount, is_deposit, notes,
        appointments (
          id, starts_at, status,
          clients ( full_name ),
          appointment_services ( services ( name ) )
        )
      `,
      )
      .gte("caja_date", firstDay)
      .lte("caja_date", lastDay)
      .order("caja_date", { ascending: false })
      .order("paid_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
}

/** Turnos del mes con la venta cerrada: la venta es del día del turno. */
export function fetchMonthSales(
  supabase: Supabase,
  firstDay: string,
  lastDay: string,
) {
  return fetchAll<ChargedAppointment>((from, to) =>
    supabase
      .from("appointments")
      .select("starts_at, payments ( amount )")
      .gte("starts_at", dayRangeISO(firstDay).start)
      .lte("starts_at", dayRangeISO(lastDay).end)
      .not("charged_at", "is", null)
      .not("status", "in", '("cancelled","no_show")')
      .order("starts_at")
      .order("id")
      .range(from, to),
  );
}
