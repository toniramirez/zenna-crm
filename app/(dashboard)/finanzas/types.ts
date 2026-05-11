import type { Database } from "@/types/database.types";

export type ExpenseTemplateRow =
  Database["public"]["Tables"]["expense_templates"]["Row"];
export type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
export type AppointmentServiceRow =
  Database["public"]["Tables"]["appointment_services"]["Row"];
