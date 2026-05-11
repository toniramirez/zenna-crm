import { z } from "zod";
import type { Database } from "@/types/database.types";

export type ExpenseCategory =
  Database["public"]["Enums"]["expense_category"];

export const EXPENSE_CATEGORIES: {
  value: ExpenseCategory;
  label: string;
}[] = [
  { value: "insumos", label: "Insumos" },
  { value: "tinturas", label: "Tinturas y productos" },
  { value: "alquiler", label: "Alquiler" },
  { value: "servicios", label: "Servicios (luz, gas, agua)" },
  { value: "sueldos", label: "Sueldos" },
  { value: "marketing", label: "Marketing" },
  { value: "otro", label: "Otro" },
];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> =
  Object.fromEntries(
    EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
  ) as Record<ExpenseCategory, string>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido.");

export const expenseSchema = z
  .object({
    category: z.enum([
      "insumos",
      "tinturas",
      "alquiler",
      "servicios",
      "sueldos",
      "marketing",
      "otro",
    ] as const),
    description: z
      .string()
      .max(300, "La descripción es muy larga.")
      .optional()
      .or(z.literal("")),
    amount: z
      .number()
      .min(0, "El importe no puede ser negativo.")
      .max(99999999, "Importe fuera de rango."),
    expenseDate: isoDate,
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
    cashSourceDate: isoDate.optional().or(z.literal("")),
    notes: z.string().max(500).optional().or(z.literal("")),
  })
  .refine(
    (v) => {
      // cash_source_date solo tiene sentido cuando el método es efectivo
      if (v.paymentMethod === "cash") {
        return !!v.cashSourceDate;
      }
      return true;
    },
    {
      message: "Cuando es en efectivo, indicá de qué caja sale.",
      path: ["cashSourceDate"],
    },
  );

export type ExpenseInput = z.infer<typeof expenseSchema>;
