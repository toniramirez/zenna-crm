import { z } from "zod";

export const payProfessionalSchema = z.object({
  professionalId: z.string().uuid("Falta la profesional."),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Período inválido."),
  amount: z
    .number()
    .min(0.01, "El monto tiene que ser mayor a cero.")
    .max(99999999, "Monto fuera de rango."),
  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido."),
  paymentMethod: z
    .enum([
      "cash",
      "transfer",
      "credit_card",
      "debit_card",
      "mp",
      "other",
    ] as const)
    .optional()
    .or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type PayProfessionalInput = z.infer<typeof payProfessionalSchema>;
