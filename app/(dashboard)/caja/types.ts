import type { Database } from "@/types/database.types";

export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
export type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
export type CashClosingRow =
  Database["public"]["Tables"]["cash_closings"]["Row"];

type PaymentMethod = Database["public"]["Enums"]["payment_method"];

/** Un movimiento de dinero de la caja, con el turno al que pertenece. */
export type PaymentWithDetails = PaymentRow & {
  appointments: {
    id: string;
    starts_at: string;
    status: Database["public"]["Enums"]["appointment_status"];
    professional_id: string;
    professionals: { id: string; full_name: string; color: string } | null;
    clients: { id: string; full_name: string } | null;
    appointment_services: {
      services: { name: string } | null;
    }[];
  } | null;
};

export type AppointmentPayment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  is_deposit: boolean;
  caja_date: string;
  paid_at: string;
};

/**
 * Un turno del día visto desde la caja: la VENTA. Pendiente mientras
 * `charged_at` es null (tenga seña o no); cerrada cuando se cobró lo que
 * faltaba o se confirmó que la seña cubría todo.
 */
export type DayAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: Database["public"]["Enums"]["appointment_status"];
  professional: { id: string; full_name: string; color: string } | null;
  client: { id: string; full_name: string; phone: string | null } | null;
  services: {
    id: string;
    name: string;
    price: number;
    duration_minutes: number;
    professional_id: string;
  }[];
  /** Suma de precios de lista. 0 = precio a definir al atender. */
  total_price: number;
  deposit_amount: number;
  deposit_method: PaymentMethod | null;
  /** Día de caja en que entró la seña. */
  deposit_paid_on: string | null;
  charged_at: string | null;
  payments: AppointmentPayment[];
};

/** Lo que entró por un turno: seña (cuando sea que se cobró) + cobro al atender. */
export function saleBreakdown(a: Pick<DayAppointment, "payments">) {
  let deposit = 0;
  let charged = 0;
  for (const p of a.payments) {
    if (p.is_deposit) deposit += Number(p.amount);
    else charged += Number(p.amount);
  }
  return { deposit, charged, total: deposit + charged };
}
