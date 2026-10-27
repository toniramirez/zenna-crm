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

/**
 * Cierre de la venta de un turno. Sin líneas es válido: es el caso en que la
 * seña cubrió todo (la base lo rechaza si el turno no tiene seña).
 */
export const recordPaymentSchema = z.object({
  appointmentId: z.string().uuid("Falta el turno."),
  lines: z.array(
    paymentLineSchema.extend({
      amount: z
        .number()
        .positive("Cada pago tiene que tener importe.")
        .max(99999999, "Importe fuera de rango."),
    }),
  ),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** Corrección del método de pagos ya cargados: sólo el método, nunca el importe. */
export const changePaymentMethodsSchema = z
  .array(
    z.object({
      id: z.string().uuid("Falta el pago."),
      method: paymentLineSchema.shape.method,
    }),
  )
  .min(1, "No hay cambios para guardar.");

export type ChangePaymentMethodsInput = z.infer<typeof changePaymentMethodsSchema>;

export const closeCajaSchema = z.object({
  cajaDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  countedCash: z
    .number({ message: "Ingresá cuánto efectivo contaste." })
    .min(0, "El efectivo contado no puede ser negativo.")
    .max(99999999, "Importe fuera de rango."),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type CloseCajaInput = z.infer<typeof closeCajaSchema>;
