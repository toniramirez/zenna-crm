import { z } from "zod";

// Each row inside the budget — a service + its quoted price range.
// The salon quotes a range (e.g. 120-150) because the final price
// depends on hair length, so min must always be ≤ max but can equal it
// when the receptionist wants a single fixed number.
export const budgetItemSchema = z
  .object({
    serviceId: z.string().uuid().nullable(),
    serviceName: z
      .string()
      .min(1, "Nombre del servicio requerido.")
      .max(120, "Nombre demasiado largo."),
    priceMin: z
      .number()
      .min(0, "El precio no puede ser negativo.")
      .max(10_000_000, "Precio fuera de rango."),
    priceMax: z
      .number()
      .min(0, "El precio no puede ser negativo.")
      .max(10_000_000, "Precio fuera de rango."),
  })
  .refine((v) => v.priceMax >= v.priceMin, {
    message: "El precio máximo debe ser ≥ al mínimo.",
    path: ["priceMax"],
  });

// One per chosen payment method on this particular budget. Carries
// the surcharge snapshot at the moment of generation so historical
// PDFs remain consistent even if the owner later tweaks the rates.
export const budgetPaymentOptionSchema = z.object({
  paymentMethodId: z.string().uuid().nullable(),
  label: z
    .string()
    .min(1, "Etiqueta requerida.")
    .max(60, "Etiqueta demasiado larga."),
  surchargePercent: z.number().min(-100).max(500),
  installments: z.number().int().min(1).max(60).nullable(),
});

export const budgetSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  clientName: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "Demasiado largo."),
  clientPhone: z.string().max(40, "Teléfono demasiado largo.").nullable(),
  notes: z.string().max(2000, "Las notas son demasiado largas.").nullable(),
  items: z.array(budgetItemSchema).min(1, "Elegí al menos un servicio."),
  paymentOptions: z
    .array(budgetPaymentOptionSchema)
    .min(1, "Elegí al menos un medio de pago."),
});

export type BudgetItemInput = z.infer<typeof budgetItemSchema>;
export type BudgetPaymentOptionInput = z.infer<
  typeof budgetPaymentOptionSchema
>;
export type BudgetInput = z.infer<typeof budgetSchema>;

/**
 * Apply a surcharge percentage to a base amount, rounded to the nearest
 * peso (ARS has no decimal coins in practice). Negative percents work as
 * discounts. Kept in a single place so the server, the PDF, and the
 * dialog preview all agree on the exact number.
 */
export function applySurcharge(base: number, percent: number): number {
  return Math.round(base * (1 + percent / 100));
}
