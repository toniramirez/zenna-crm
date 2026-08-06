import type { Database } from "@/types/database.types";

export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
export type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];

export type PaymentWithDetails = PaymentRow & {
  appointments: {
    id: string;
    starts_at: string;
    professional_id: string;
    professionals: { id: string; full_name: string; color: string } | null;
    clients: { id: string; full_name: string } | null;
    appointment_services: {
      services: { name: string } | null;
    }[];
  } | null;
};

export type UnpaidAppointment = {
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
  total_price: number;
  deposit_amount: number;
  deposit_method: Database["public"]["Enums"]["payment_method"] | null;
};
