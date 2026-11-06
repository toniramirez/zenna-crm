import { z } from "zod";
import { broadcastFiltersSchema } from "@/lib/broadcasts/filters";
import { templateParamsSchema } from "./crm-config";

/**
 * Las variables que entiende una difusión. Es una sola a propósito: una
 * difusión no sale de un turno, así que `{{fecha}}`, `{{servicio}}` y compañía
 * no tienen de dónde sacar valor. Ofrecerlas sería prometer un dato que
 * llegaría vacío —o peor, como `{{fecha}}` literal en el celular de la
 * clienta—.
 */
export const BROADCAST_VARIABLES = [
  { key: "nombre", label: "Nombre de la clienta" },
] as const;

const KNOWN = new Set<string>(BROADCAST_VARIABLES.map((v) => v.key));

/** Las `{{variables}}` de un texto que la difusión no sabe completar. */
export function unknownBroadcastVariables(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (!KNOWN.has(match[1])) out.add(match[1]);
  }
  return [...out];
}

function unknownMessage(tokens: string[]): string {
  const list = tokens.map((t) => `{{${t}}}`).join(", ");
  return `Una difusión solo sabe completar {{nombre}}. Sacá ${list}.`;
}

export const broadcastSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Ponele un nombre.")
      .max(120, "El nombre es muy largo."),
    filters: broadcastFiltersSchema,
    sendMode: z.enum(["text", "template"]),
    messageBody: z.string().max(4096, "El mensaje es muy largo."),
    templateName: z.string().optional(),
    templateLanguage: z.string().optional(),
    templateParams: templateParamsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.sendMode === "text") {
      if (!value.messageBody.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["messageBody"],
          message: "Escribí el mensaje.",
        });
      }
      const unknown = unknownBroadcastVariables(value.messageBody);
      if (unknown.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["messageBody"],
          message: unknownMessage(unknown),
        });
      }
      return;
    }

    if (!value.templateName?.trim() || !value.templateLanguage?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["templateName"],
        message: "Elegí una plantilla aprobada.",
      });
    }
    const unknown = [
      ...Object.values(value.templateParams.header),
      ...Object.values(value.templateParams.body),
    ].flatMap(unknownBroadcastVariables);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["templateName"],
        message: unknownMessage([...new Set(unknown)]),
      });
    }
  });

export type BroadcastInput = z.infer<typeof broadcastSchema>;

/**
 * Qué hacer al guardar: dejarla en borrador, mandarla ya, o programarla.
 * `at` es la hora local del salón ("2026-11-10T10:30"), sin zona: la
 * convierte el servidor con ZENNA_TZ, así no depende de la hora del celular.
 */
export const broadcastScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft") }),
  z.object({ kind: z.literal("now") }),
  z.object({
    kind: z.literal("at"),
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Elegí fecha y hora."),
  }),
]);

export type BroadcastSchedule = z.infer<typeof broadcastScheduleSchema>;
