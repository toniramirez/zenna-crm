import { z } from "zod";
import type { Database } from "@/types/database.types";

export type AppointmentStatus =
  Database["public"]["Enums"]["appointment_status"];

const PAYMENT_METHOD_VALUES = [
  "cash",
  "transfer",
  "credit_card",
  "debit_card",
  "mp",
  "other",
] as const;

export const APPOINTMENT_STATUSES: {
  value: AppointmentStatus;
  label: string;
}[] = [
  { value: "scheduled", label: "Programado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "in_progress", label: "En curso" },
  { value: "completed", label: "Completado" },
  { value: "no_show", label: "No vino" },
  { value: "cancelled", label: "Cancelado" },
];

export const STATUS_LABEL: Record<AppointmentStatus, string> =
  Object.fromEntries(
    APPOINTMENT_STATUSES.map((s) => [s.value, s.label]),
  ) as Record<AppointmentStatus, string>;

/**
 * Tailwind class snippets per status. Used for the badge that decorates
 * status labels in lists. The calendar uses STATUS_HEX (in calendar-view)
 * for its inline event styles.
 */
export const STATUS_TONE: Record<
  AppointmentStatus,
  { bg: string; text: string; border: string }
> = {
  scheduled: {
    bg: "bg-stone-100",
    text: "text-stone-900",
    border: "border-stone-300",
  },
  confirmed: {
    bg: "bg-sky-100",
    text: "text-sky-900",
    border: "border-sky-400",
  },
  in_progress: {
    bg: "bg-amber-100",
    text: "text-amber-900",
    border: "border-amber-400",
  },
  completed: {
    bg: "bg-emerald-100",
    text: "text-emerald-900",
    border: "border-emerald-400",
  },
  no_show: {
    bg: "bg-rose-100",
    text: "text-rose-900",
    border: "border-rose-400",
  },
  cancelled: {
    bg: "bg-stone-100",
    text: "text-stone-500 line-through",
    border: "border-stone-300",
  },
};

export const appointmentSchema = z
  .object({
    clientId: z.string().uuid("Elegí una clienta."),
    professionalId: z.string().uuid("Elegí una profesional."),
    startsAt: z.string().min(1, "Falta hora de inicio."),
    endsAt: z.string().min(1, "Falta hora de fin."),
    status: z.enum([
      "scheduled",
      "confirmed",
      "in_progress",
      "completed",
      "no_show",
      "cancelled",
    ] as const),
    notes: z
      .string()
      .max(500, "Notas muy largas.")
      .optional()
      .or(z.literal("")),
    serviceIds: z
      .array(z.string().uuid())
      .min(1, "Elegí al menos un servicio."),
    // Seña / adelanto cobrado al agendar. Se guarda en el turno y se descuenta
    // al momento de cobrar. 0 = sin seña.
    depositAmount: z
      .number()
      .min(0, "La seña no puede ser negativa.")
      .max(99999999, "Seña fuera de rango.")
      .default(0),
    depositMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
    message: "El fin tiene que ser posterior al inicio.",
    path: ["endsAt"],
  })
  .refine((d) => d.depositAmount === 0 || !!d.depositMethod, {
    message: "Elegí con qué método se pagó la seña.",
    path: ["depositMethod"],
  });

export type AppointmentInput = z.infer<typeof appointmentSchema>;

export const moveAppointmentSchema = z
  .object({
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    professionalId: z.string().uuid().optional(),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
    message: "El fin tiene que ser posterior al inicio.",
    path: ["endsAt"],
  });

export type MoveAppointmentInput = z.infer<typeof moveAppointmentSchema>;
