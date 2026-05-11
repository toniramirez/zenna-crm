import { z } from "zod";

export const expenseTemplateSchema = z.object({
  name: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "El nombre es muy largo."),
  category: z.enum([
    "insumos",
    "tinturas",
    "alquiler",
    "servicios",
    "sueldos",
    "marketing",
    "otro",
  ] as const),
  defaultPaymentMethod: z
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
  defaultAmount: z
    .number()
    .min(0, "El monto no puede ser negativo.")
    .max(99999999, "Monto fuera de rango.")
    .optional()
    .nullable(),
  dueDay: z
    .number()
    .int("Día inválido.")
    .min(1, "Mínimo día 1.")
    .max(28, "Máximo día 28."),
  notes: z
    .string()
    .max(500, "Las notas son muy largas.")
    .optional()
    .or(z.literal("")),
  active: z.boolean(),
});

export type ExpenseTemplateInput = z.infer<typeof expenseTemplateSchema>;

export const payTemplateSchema = z.object({
  templateId: z.string().uuid("Falta la plantilla."),
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

export type PayTemplateInput = z.infer<typeof payTemplateSchema>;

/** "YYYY-MM" → "YYYY-MM-01" (DB period column). */
export function monthToPeriod(monthStr: string): string {
  return `${monthStr}-01`;
}

/** Validate or default to current month. */
export function safeMonth(input: string | undefined | null): string {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split("-").map(Number);
    if (y >= 2020 && y <= 2100 && m >= 1 && m <= 12) return input;
  }
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
