"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  appointmentSchema,
  moveAppointmentSchema,
  type AppointmentStatus,
} from "@/lib/validations/appointments";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

/**
 * Map common Postgres errors to user-friendly Spanish messages.
 * 23P01 = exclusion_violation (our `appointments_no_overlap` constraint).
 *
 * Anything we don't recognize gets logged server-side with the raw code +
 * message so future bugs surface in `npm run dev` console instead of
 * disappearing behind a generic toast.
 */
function mapAppointmentError(error: { code?: string; message?: string }) {
  if (error.code === "23P01") {
    return "Esa franja horaria ya está ocupada para esa profesional.";
  }
  if (error.code === "23514") {
    return "El horario de fin tiene que ser posterior al de inicio.";
  }
  console.error("[appointments] unhandled DB error:", error.code, error.message);
  if (process.env.NODE_ENV !== "production") {
    return `Error DB${error.code ? ` ${error.code}` : ""}: ${error.message ?? "desconocido"}`;
  }
  return "No pudimos guardar el turno. Intentalo de nuevo.";
}

// ─────────────────────────────────────────── Create

export async function createAppointmentAction(
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const serviceIdsRaw = formData.get("serviceIds");
  const serviceIds =
    typeof serviceIdsRaw === "string"
      ? serviceIdsRaw.split(",").filter((s) => s.length > 0)
      : [];

  const parsed = appointmentSchema.safeParse({
    clientId: formData.get("clientId"),
    professionalId: formData.get("professionalId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    status: formData.get("status") || "scheduled",
    notes: formData.get("notes") || undefined,
    serviceIds,
    depositAmount: Number(formData.get("depositAmount")) || 0,
    depositMethod: formData.get("depositMethod") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  // Snapshot current price + duration of each selected service
  const { data: services, error: svcError } = await supabase
    .from("services")
    .select("id, price, duration_minutes")
    .in("id", parsed.data.serviceIds);

  if (svcError || !services || services.length !== parsed.data.serviceIds.length) {
    return { error: "Algunos servicios elegidos no son válidos." };
  }

  const { data: appt, error: apptError } = await supabase
    .from("appointments")
    .insert({
      client_id: parsed.data.clientId,
      professional_id: parsed.data.professionalId,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      deposit_amount: parsed.data.depositAmount,
      deposit_method: parsed.data.depositAmount > 0
        ? parsed.data.depositMethod ?? null
        : null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (apptError || !appt) {
    return { error: mapAppointmentError(apptError ?? {}) };
  }

  // Snapshot per-service rows
  const { error: linesError } = await supabase
    .from("appointment_services")
    .insert(
      services.map((s) => ({
        appointment_id: appt.id,
        service_id: s.id,
        professional_id: parsed.data.professionalId,
        price_at_booking: s.price,
        duration_at_booking: s.duration_minutes,
      })),
    );

  if (linesError) {
    // Roll back the parent appointment so we don't leave orphans
    await supabase.from("appointments").delete().eq("id", appt.id);
    return { error: "No pudimos guardar los servicios del turno." };
  }

  revalidatePath("/turnos");
  return { success: true };
}

// ─────────────────────────────────────────── Update (replace lines)

export async function updateAppointmentAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const serviceIdsRaw = formData.get("serviceIds");
  const serviceIds =
    typeof serviceIdsRaw === "string"
      ? serviceIdsRaw.split(",").filter((s) => s.length > 0)
      : [];

  const parsed = appointmentSchema.safeParse({
    clientId: formData.get("clientId"),
    professionalId: formData.get("professionalId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    status: formData.get("status") || "scheduled",
    notes: formData.get("notes") || undefined,
    serviceIds,
    depositAmount: Number(formData.get("depositAmount")) || 0,
    depositMethod: formData.get("depositMethod") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  const { error: updError } = await supabase
    .from("appointments")
    .update({
      client_id: parsed.data.clientId,
      professional_id: parsed.data.professionalId,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      deposit_amount: parsed.data.depositAmount,
      deposit_method: parsed.data.depositAmount > 0
        ? parsed.data.depositMethod ?? null
        : null,
    })
    .eq("id", id);

  if (updError) return { error: mapAppointmentError(updError) };

  // Replace service lines
  const { error: delLinesError } = await supabase
    .from("appointment_services")
    .delete()
    .eq("appointment_id", id);

  if (delLinesError) {
    return { error: "No pudimos actualizar los servicios del turno." };
  }

  const { data: services, error: svcError } = await supabase
    .from("services")
    .select("id, price, duration_minutes")
    .in("id", parsed.data.serviceIds);

  if (svcError || !services || services.length !== parsed.data.serviceIds.length) {
    return { error: "Algunos servicios elegidos no son válidos." };
  }

  const { error: insLinesError } = await supabase
    .from("appointment_services")
    .insert(
      services.map((s) => ({
        appointment_id: id,
        service_id: s.id,
        professional_id: parsed.data.professionalId,
        price_at_booking: s.price,
        duration_at_booking: s.duration_minutes,
      })),
    );

  if (insLinesError) {
    return { error: "No pudimos guardar los servicios del turno." };
  }

  revalidatePath("/turnos");
  return { success: true };
}

// ─────────────────────────────────────────── Drag/resize: move only

export async function moveAppointmentAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = moveAppointmentSchema.safeParse({
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    professionalId: formData.get("professionalId") || undefined,
  });

  if (!parsed.success) {
    return { error: "El nuevo horario es inválido." };
  }

  const supabase = await createClient();
  const updates: {
    starts_at: string;
    ends_at: string;
    professional_id?: string;
  } = {
    starts_at: parsed.data.startsAt,
    ends_at: parsed.data.endsAt,
  };
  if (parsed.data.professionalId) {
    updates.professional_id = parsed.data.professionalId;
  }

  const { error } = await supabase
    .from("appointments")
    .update(updates)
    .eq("id", id);

  if (error) return { error: mapAppointmentError(error) };

  // Also update appointment_services.professional_id to stay in sync
  // (V1: all services follow the main pro)
  if (parsed.data.professionalId) {
    await supabase
      .from("appointment_services")
      .update({ professional_id: parsed.data.professionalId })
      .eq("appointment_id", id);
  }

  revalidatePath("/turnos");
  return { success: true };
}

// ─────────────────────────────────────────── Status change

export async function updateAppointmentStatusAction(
  id: string,
  status: AppointmentStatus,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id);

  if (error) return { error: "No pudimos cambiar el estado." };

  revalidatePath("/turnos");
  return { success: true };
}

// ─────────────────────────────────────────── Cancel (soft delete)

export async function cancelAppointmentAction(
  id: string,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) return { error: "No pudimos cancelar el turno." };

  revalidatePath("/turnos");
  return { success: true };
}

// ─────────────────────────────────────────── Refresh helper

export async function getAppointmentsInRangeAction(
  rangeStart: string,
  rangeEnd: string,
) {
  await requireProfile();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "*, appointment_services(*, services(id, name, category)), clients(id, full_name, phone)",
    )
    .gte("starts_at", rangeStart)
    .lt("starts_at", rangeEnd)
    .order("starts_at");

  if (error) return { error: "No pudimos cargar los turnos.", events: [] };
  return { events: data ?? [] };
}
