import { z } from "zod";
import type { Database } from "@/types/database.types";

export type ServiceCategory = Database["public"]["Enums"]["service_category"];

export const SERVICE_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: "corte", label: "Corte" },
  { value: "color", label: "Color" },
  { value: "tratamiento", label: "Tratamiento" },
  { value: "manos", label: "Manos" },
  { value: "depilacion", label: "Depilación" },
  { value: "make_up", label: "Make-up" },
  { value: "peinado", label: "Peinado" },
  { value: "otro", label: "Otro" },
];

export const CATEGORY_LABEL: Record<ServiceCategory, string> = Object.fromEntries(
  SERVICE_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<ServiceCategory, string>;

export const serviceSchema = z.object({
  name: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "El nombre es muy largo."),
  description: z
    .string()
    .max(500, "La descripción es muy larga.")
    .optional()
    .or(z.literal("")),
  category: z.enum([
    "corte",
    "color",
    "tratamiento",
    "manos",
    "depilacion",
    "make_up",
    "peinado",
    "otro",
  ] as const),
  durationMinutes: z
    .number()
    .int("La duración tiene que ser un número entero.")
    .min(5, "Mínimo 5 minutos.")
    .max(600, "Máximo 10 horas (600 min)."),
  price: z
    .number()
    .min(0, "El precio no puede ser negativo.")
    .max(99999999, "Precio fuera de rango."),
  active: z.boolean(),
});

export type ServiceInput = z.infer<typeof serviceSchema>;
