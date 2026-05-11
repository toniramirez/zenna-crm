import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const professionalSchema = z.object({
  fullName: z
    .string()
    .min(2, "El nombre es muy corto.")
    .max(120, "El nombre es muy largo."),
  phone: z
    .string()
    .max(40, "Teléfono muy largo.")
    .optional()
    .or(z.literal("")),
  color: z.string().regex(HEX_COLOR, "El color tiene que ser un hex #RRGGBB."),
  commissionRate: z
    .number()
    .min(0, "La comisión no puede ser negativa.")
    .max(100, "La comisión máxima es 100%."),
  commissionRateNet: z
    .number()
    .min(0, "La comisión no puede ser negativa.")
    .max(100, "La comisión máxima es 100%."),
  active: z.boolean(),
});

export type ProfessionalInput = z.infer<typeof professionalSchema>;

// Weekly schedule. We accept up to 7 entries (one per weekday); each entry
// has weekday + start_time + end_time. Days where the pro doesn't work are
// simply missing from the array.
export const scheduleEntrySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato hh:mm requerido."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato hh:mm requerido."),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "El horario de fin tiene que ser posterior al de inicio.",
    path: ["endTime"],
  });

export const scheduleSchema = z.object({
  entries: z.array(scheduleEntrySchema).max(7, "Máximo 7 entradas."),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const timeOffSchema = z
  .object({
    startsAt: z.string().min(1, "Fecha de inicio requerida."),
    endsAt: z.string().min(1, "Fecha de fin requerida."),
    reason: z
      .string()
      .max(200, "Motivo muy largo.")
      .optional()
      .or(z.literal("")),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "La fecha de fin tiene que ser posterior al inicio.",
    path: ["endsAt"],
  });

export type TimeOffInput = z.infer<typeof timeOffSchema>;

export const WEEKDAYS = [
  { value: 1, short: "Lun", long: "Lunes" },
  { value: 2, short: "Mar", long: "Martes" },
  { value: 3, short: "Mié", long: "Miércoles" },
  { value: 4, short: "Jue", long: "Jueves" },
  { value: 5, short: "Vie", long: "Viernes" },
  { value: 6, short: "Sáb", long: "Sábado" },
  { value: 0, short: "Dom", long: "Domingo" },
] as const;
