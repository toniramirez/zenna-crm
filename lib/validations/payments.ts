import { z } from "zod";
import type { Database } from "@/types/database.types";

export type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; short: string }[] = [
  { value: "cash", label: "Efectivo", short: "Efectivo" },
  { value: "transfer", label: "Transferencia", short: "Transferencia" },
  { value: "credit_card", label: "Tarjeta de crédito", short: "Crédito" },
  { value: "debit_card", label: "Tarjeta de débito", short: "Débito" },
  { value: "mp", label: "MercadoPago", short: "MercadoPago" },
  { value: "other", label: "Otro", short: "Otro" },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label]),
) as Record<PaymentMethod, string>;

export const paymentLineSchema = z.object({
  method: z.enum([
    "cash",
    "transfer",
    "credit_card",
    "debit_card",
    "mp",
    "other",
  ] as const),
  amount: z
    .number()
    .min(0, "Importe no puede ser negativo.")
    .max(99999999, "Importe fuera de rango."),
});

export type PaymentLineInput = z.infer<typeof paymentLineSchema>;

export const recordPaymentSchema = z.object({
  appointmentId: z.string().uuid("Falta el turno."),
  lines: z
    .array(paymentLineSchema)
    .min(1, "Cargá al menos una línea de pago.")
    .refine((arr) => arr.some((l) => l.amount > 0), {
      message: "Al menos una línea tiene que tener importe > 0.",
    }),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
