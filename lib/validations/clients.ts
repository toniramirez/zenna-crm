import { z } from "zod";

export const clientSchema = z.object({
  fullName: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "El nombre es muy largo."),
  phone: z
    .string()
    .max(40, "Teléfono muy largo.")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .max(160, "Email muy largo.")
    .email("Email inválido.")
    .optional()
    .or(z.literal("")),
  instagramHandle: z
    .string()
    .max(40, "Usuario muy largo.")
    .optional()
    .or(z.literal("")),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido.")
    .optional()
    .or(z.literal("")),
  hairNotes: z
    .string()
    .max(2000, "Las notas son muy largas.")
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .max(2000, "Las notas son muy largas.")
    .optional()
    .or(z.literal("")),
  tags: z.array(z.string().min(1).max(40)).max(20, "Máximo 20 tags."),
});

export type ClientInput = z.infer<typeof clientSchema>;

/**
 * Convert a comma/whitespace-separated string into a clean tag array.
 * "vip, color, novia" → ["vip", "color", "novia"]
 */
export function parseTagsString(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  );
}

export function tagsToString(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}
