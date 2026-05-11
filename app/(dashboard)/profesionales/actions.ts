"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  professionalSchema,
  scheduleSchema,
  timeOffSchema,
} from "@/lib/validations/professionals";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

// ─────────────────────────────────────────── Professional CRUD

export async function createProfessionalAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = professionalSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    color: formData.get("color"),
    commissionRate: Number(formData.get("commissionRate")),
    commissionRateNet: Number(formData.get("commissionRateNet") ?? 0),
    active: formData.get("active") === "true",
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("professionals").insert({
    full_name: parsed.data.fullName,
    phone: parsed.data.phone || null,
    color: parsed.data.color,
    commission_rate: parsed.data.commissionRate,
    commission_rate_net: parsed.data.commissionRateNet,
    active: parsed.data.active,
  });

  if (error) return { error: "No pudimos crear la profesional." };

  revalidatePath("/profesionales");
  return { success: true };
}

export async function updateProfessionalAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = professionalSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    color: formData.get("color"),
    commissionRate: Number(formData.get("commissionRate")),
    commissionRateNet: Number(formData.get("commissionRateNet") ?? 0),
    active: formData.get("active") === "true",
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("professionals")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone || null,
      color: parsed.data.color,
      commission_rate: parsed.data.commissionRate,
      commission_rate_net: parsed.data.commissionRateNet,
      active: parsed.data.active,
    })
    .eq("id", id);

  if (error) return { error: "No pudimos guardar los cambios." };

  revalidatePath("/profesionales");
  return { success: true };
}

export async function toggleProfessionalActiveAction(
  id: string,
  active: boolean,
) {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("professionals")
    .update({ active })
    .eq("id", id);
  if (error) return { error: "No pudimos cambiar el estado." };
  revalidatePath("/profesionales");
  return { success: true };
}

// ─────────────────────────────────────────── Schedule

export async function getScheduleAction(professionalId: string) {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("professional_schedules")
    .select("*")
    .eq("professional_id", professionalId)
    .order("weekday");
  if (error) return { error: "No pudimos cargar el horario.", entries: [] };
  return { entries: data ?? [] };
}

/**
 * Replace the entire weekly schedule for a professional. We delete all existing
 * rows and insert the new ones in a single transaction-ish flow. Postgres RLS
 * + the server action context guards permissions.
 */
export async function replaceScheduleAction(
  professionalId: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const raw = formData.get("entries");
  if (typeof raw !== "string") return { error: "Datos inválidos." };

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return { error: "Datos inválidos." };
  }

  const parsed = scheduleSchema.safeParse({ entries });
  if (!parsed.success) {
    return { error: "Revisá los horarios — hay datos inválidos." };
  }

  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("professional_schedules")
    .delete()
    .eq("professional_id", professionalId);
  if (delError) return { error: "No pudimos limpiar el horario anterior." };

  if (parsed.data.entries.length > 0) {
    const { error: insError } = await supabase
      .from("professional_schedules")
      .insert(
        parsed.data.entries.map((e) => ({
          professional_id: professionalId,
          weekday: e.weekday,
          start_time: e.startTime,
          end_time: e.endTime,
        })),
      );
    if (insError) return { error: "No pudimos guardar el nuevo horario." };
  }

  revalidatePath("/profesionales");
  return { success: true };
}

// ─────────────────────────────────────────── Time off

export async function getTimeOffAction(professionalId: string) {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("professional_time_off")
    .select("*")
    .eq("professional_id", professionalId)
    .order("starts_at", { ascending: false });
  if (error) return { error: "No pudimos cargar los días libres.", entries: [] };
  return { entries: data ?? [] };
}

export async function addTimeOffAction(
  professionalId: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = timeOffSchema.safeParse({
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("professional_time_off").insert({
    professional_id: professionalId,
    starts_at: parsed.data.startsAt,
    ends_at: parsed.data.endsAt,
    reason: parsed.data.reason || null,
  });
  if (error) return { error: "No pudimos guardar el día libre." };

  revalidatePath("/profesionales");
  return { success: true };
}

export async function deleteTimeOffAction(id: string) {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("professional_time_off")
    .delete()
    .eq("id", id);
  if (error) return { error: "No pudimos eliminar el registro." };
  revalidatePath("/profesionales");
  return { success: true };
}
