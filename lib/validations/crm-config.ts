import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ──────────────── Tags ────────────────

export const clientTagSchema = z.object({
  name: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(40, "El nombre es muy largo."),
  color: z.string().regex(HEX_COLOR, "Color hex inválido."),
  active: z.boolean(),
});

export type ClientTagInput = z.infer<typeof clientTagSchema>;

// ──────────────── Quick replies ────────────────

export const quickReplySchema = z.object({
  label: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(80, "El nombre es muy largo."),
  body: z
    .string()
    .min(1, "El mensaje no puede estar vacío.")
    .max(4000, "El mensaje es demasiado largo."),
  shortcut: z
    .string()
    .max(40, "Atajo demasiado largo.")
    .optional()
    .or(z.literal("")),
  active: z.boolean(),
});

export type QuickReplyInput = z.infer<typeof quickReplySchema>;

// ──────────────── Automation flows ────────────────

export type AutomationTrigger =
  | "before_appointment"
  | "after_appointment"
  | "after_payment"
  | "on_inbound_after_inactivity";

export const TRIGGERS: {
  value: AutomationTrigger;
  label: string;
}[] = [
  { value: "before_appointment", label: "Antes del turno" },
  { value: "after_appointment", label: "Después del turno" },
  { value: "after_payment", label: "Después de cobrar el turno" },
  {
    value: "on_inbound_after_inactivity",
    label: "Mensaje entrante tras inactividad",
  },
];

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  before_appointment: "Antes del turno",
  after_appointment: "Después del turno",
  after_payment: "Después de cobrar",
  on_inbound_after_inactivity: "Mensaje entrante",
};

/** Triggers that operate on appointments and accept service filtering. */
export const APPOINTMENT_TRIGGERS: AutomationTrigger[] = [
  "before_appointment",
  "after_appointment",
  "after_payment",
];

/** Los dos editores del panel: texto simple, o encuesta de reseña. */
export type AutomationKind = "message" | "review";

export const automationFlowSchema = z
  .object({
    name: z
      .string()
      .min(2, "El nombre es muy corto.")
      .max(120, "El nombre es muy largo."),
    trigger: z.enum([
      "before_appointment",
      "after_appointment",
      "after_payment",
      "on_inbound_after_inactivity",
    ] as const),
    triggerOffsetMinutes: z
      .number()
      .int("Tiene que ser un número entero.")
      .min(0, "El offset no puede ser negativo.")
      .max(525600, "El offset es demasiado grande."),
    serviceFilterIds: z.array(z.string().uuid()),
    messageBody: z
      .string()
      .min(2, "El mensaje es muy corto.")
      .max(4000, "El mensaje es demasiado largo."),
    active: z.boolean(),
  })
  .refine(
    (v) =>
      APPOINTMENT_TRIGGERS.includes(v.trigger) || v.serviceFilterIds.length === 0,
    {
      message: "El filtro por servicio solo aplica a triggers de turno.",
      path: ["serviceFilterIds"],
    },
  );

export type AutomationFlowInput = z.infer<typeof automationFlowSchema>;

/** Convert minutes to a friendly "1 día 2 horas" string. */
export function formatOffsetMinutes(mins: number): string {
  if (mins === 0) return "al toque";
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "día" : "días"}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.join(" ");
}

/** Render a template string with WhatsApp-style {{var}} placeholders. */
export function renderTemplate(
  template: string,
  ctx: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = ctx[key];
    if (v === null || v === undefined) return `{{${key}}}`;
    return v;
  });
}

export const TEMPLATE_VARIABLES = [
  { key: "nombre", label: "Nombre de la clienta" },
  { key: "servicio", label: "Servicios del turno" },
  { key: "fecha", label: "Fecha (10 may)" },
  { key: "hora", label: "Hora (14:30)" },
  { key: "profesional", label: "Profesional" },
] as const;

// ──────────────── Flujo de reseña ────────────────

/**
 * El flujo de reseña es una fila de `automation_flows` con `kind='review'`,
 * no una tabla aparte: comparte nombre, activo, offset y filtro por servicio
 * con los flujos comunes, y agrega la pregunta (que va en `message_body`) más
 * las tres respuestas por puntaje.
 *
 * El trigger es siempre `after_payment` — la encuesta se manda cuando el turno
 * ya se cobró, que es cuando la clienta terminó de vivir la experiencia — así
 * que no se elige en el formulario.
 */
export const reviewFlowSchema = z.object({
  name: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "El nombre es muy largo."),
  triggerOffsetMinutes: z
    .number()
    .int("Tiene que ser un número entero.")
    .min(0, "El offset no puede ser negativo.")
    .max(525600, "El offset es demasiado grande."),
  serviceFilterIds: z.array(z.string().uuid()),
  salonName: z
    .string()
    .max(120, "El nombre del salón es muy largo.")
    .optional()
    .or(z.literal("")),
  googleUrl: z
    .string()
    .trim()
    .url("Tiene que ser un link válido (https://…).")
    .max(500, "El link es demasiado largo.")
    .optional()
    .or(z.literal("")),
  question: z
    .string()
    .min(2, "La pregunta es muy corta.")
    .max(4000, "La pregunta es demasiado larga."),
  replyHigh: z
    .string()
    .min(2, "La respuesta es muy corta.")
    .max(4000, "La respuesta es demasiado larga."),
  replyMid: z
    .string()
    .min(2, "La respuesta es muy corta.")
    .max(4000, "La respuesta es demasiado larga."),
  replyLow: z
    .string()
    .min(2, "La respuesta es muy corta.")
    .max(4000, "La respuesta es demasiado larga."),
  active: z.boolean(),
});

export type ReviewFlowInput = z.infer<typeof reviewFlowSchema>;

/** Variables de la pregunta: todo lo del turno más el nombre del salón. */
export const REVIEW_QUESTION_VARIABLES = [
  { key: "nombre", label: "Nombre de la clienta" },
  { key: "salon", label: "Nombre del salón" },
  { key: "servicio", label: "Servicios del turno" },
  { key: "profesional", label: "Profesional" },
] as const;

/**
 * Variables de las respuestas. `link` solo tiene sentido acá: es el link de
 * Google al que mandamos a quien puntuó 5.
 */
export const REVIEW_REPLY_VARIABLES = [
  { key: "nombre", label: "Nombre de la clienta" },
  { key: "salon", label: "Nombre del salón" },
  { key: "link", label: "Link de reseña" },
] as const;

// ──────────────── Payment methods ────────────────

export const paymentMethodSchema = z.object({
  label: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(60, "El nombre es muy largo."),
  surchargePercent: z
    .number()
    .min(-100, "El descuento máximo es 100%.")
    .max(500, "El recargo máximo es 500%."),
  installments: z
    .number()
    .int("Tienen que ser cuotas enteras.")
    .min(1, "Mínimo 1 cuota.")
    .max(60, "Máximo 60 cuotas.")
    .nullable(),
  active: z.boolean(),
});

export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
