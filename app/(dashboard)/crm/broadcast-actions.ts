"use server";

import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { resolveAudience } from "@/lib/broadcasts/audience";
import { broadcastFiltersSchema } from "@/lib/broadcasts/filters";
import { loadBroadcastsWithStats } from "@/lib/broadcasts/load";
import type {
  BroadcastRecipientView,
  BroadcastWithStats,
} from "@/lib/broadcasts/types";
import { ZENNA_TZ } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  type BroadcastInput,
  broadcastScheduleSchema,
  broadcastSchema,
  type BroadcastSchedule,
} from "@/lib/validations/broadcasts";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";
import type { Json } from "@/types/database.types";

/**
 * Server actions de Difusiones (CRM → Configuración → Difusiones).
 *
 * Acá no se manda nada: armar, programar y cancelar son cambios de estado
 * sobre `broadcasts`, y el envío lo hace worker/broadcasts.ts. Así "Enviar
 * ahora" y "Programar para el viernes" recorren exactamente el mismo camino.
 */

export type BroadcastActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
  id?: string;
};

/** Cuántos nombres de muestra devuelve la vista previa del segmento. */
const PREVIEW_SAMPLE = 8;

/** Lo más lejos que se puede programar. Más allá suele ser un error de tipeo. */
const MAX_SCHEDULE_AHEAD_MS = 90 * 86_400_000;

// ───────────────────────────── Vista previa del segmento

export type AudiencePreview = {
  error?: string;
  count?: number;
  matched?: number;
  excluded?: number;
  noPhone?: number;
  duplicates?: number;
  shortPhones?: number;
  sample?: string[];
};

export async function previewBroadcastAudienceAction(
  rawFilters: unknown,
): Promise<AudiencePreview> {
  await requireRole("owner");
  const parsed = broadcastFiltersSchema.safeParse(rawFilters);
  // Un filtro a medio completar (una etiqueta sin elegir) no es un error que
  // mostrar en rojo: el editor ya marca el campo. Solo no hay número todavía.
  if (!parsed.success) {
    return { error: "Completá los filtros para ver a quiénes les llega." };
  }

  const supabase = await createClient();
  try {
    const result = await resolveAudience(supabase, parsed.data, {
      checkReachability: true,
    });
    return {
      // Las que se van a saltear por el teléfono no cuentan en el número
      // grande: "le llega a" tiene que ser a cuántas les llega de verdad.
      count: result.members.length - result.shortPhones,
      matched: result.matched,
      excluded: result.excluded,
      noPhone: result.noPhone,
      duplicates: result.duplicates,
      shortPhones: result.shortPhones,
      sample: result.members.slice(0, PREVIEW_SAMPLE).map((m) => m.fullName),
    };
  } catch (err) {
    console.error(
      "[broadcasts] preview error:",
      err instanceof Error ? err.message : err,
    );
    return { error: "No pudimos calcular el segmento." };
  }
}

// ───────────────────────────── Guardar / programar

function columnsOf(input: BroadcastInput) {
  const isTemplate = input.sendMode === "template";
  return {
    name: input.name.trim(),
    filters: input.filters as unknown as Json,
    send_mode: input.sendMode,
    message_body: input.messageBody,
    template_name: isTemplate ? input.templateName?.trim() || null : null,
    template_language: isTemplate
      ? input.templateLanguage?.trim() || null
      : null,
    template_params: (isTemplate
      ? input.templateParams
      : { header: {}, body: {} }) as unknown as Json,
  };
}

function scheduleColumns(
  schedule: BroadcastSchedule,
  now: Date,
):
  | { ok: true; status: "draft" | "scheduled"; scheduled_for: string | null }
  | { ok: false; error: string } {
  if (schedule.kind === "draft") {
    return { ok: true, status: "draft", scheduled_for: null };
  }
  if (schedule.kind === "now") {
    return { ok: true, status: "scheduled", scheduled_for: now.toISOString() };
  }

  const at = fromZonedTime(`${schedule.at}:00`, ZENNA_TZ);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: "La fecha de envío no es válida." };
  }
  // Un minuto de gracia: elegir "ahora mismo" en el selector y tardar en
  // tocar Guardar no tiene por qué ser un error.
  if (at.getTime() < now.getTime() - 60_000) {
    return { ok: false, error: "La fecha de envío ya pasó." };
  }
  if (at.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
    return {
      ok: false,
      error: "Se puede programar hasta 90 días para adelante.",
    };
  }
  return { ok: true, status: "scheduled", scheduled_for: at.toISOString() };
}

/**
 * Crea o edita una difusión y, en el mismo paso, decide si queda en borrador
 * o programada. Que sea una sola acción evita el estado intermedio "guardé
 * los cambios pero falló programarla" con una difusión a medias.
 *
 * Solo se editan las que no arrancaron: una vez que el worker sacó la foto
 * del segmento, cambiar el mensaje dejaría a la mitad de las clientas con
 * una versión y a la otra mitad con otra.
 */
export async function saveBroadcastAction(
  id: string | null,
  rawInput: unknown,
  rawSchedule: unknown,
): Promise<BroadcastActionState> {
  const ctx = await requireRole("owner");

  const parsed = broadcastSchema.safeParse(rawInput);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const scheduleParsed = broadcastScheduleSchema.safeParse(rawSchedule);
  if (!scheduleParsed.success) return { error: "Elegí cuándo mandarla." };

  const now = new Date();
  const schedule = scheduleColumns(scheduleParsed.data, now);
  if (!schedule.ok) return { fieldErrors: { scheduledFor: schedule.error } };

  const supabase = await createClient();
  const row = {
    ...columnsOf(parsed.data),
    status: schedule.status,
    scheduled_for: schedule.scheduled_for,
    // Lo que haya fallado en un intento anterior ya no aplica a esta versión.
    last_error: null,
  };

  if (id) {
    const { data, error } = await supabase
      .from("broadcasts")
      .update(row)
      .eq("id", id)
      .in("status", ["draft", "scheduled"])
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[broadcasts] update error:", error.message);
      return { error: "No pudimos guardar la difusión." };
    }
    if (!data) {
      return {
        error:
          "La difusión ya empezó a salir (o se borró): no se puede editar. Duplicala para armar otra igual.",
      };
    }
    revalidatePath("/crm");
    return { success: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("broadcasts")
    .insert({ ...row, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[broadcasts] insert error:", error?.message);
    return { error: "No pudimos crear la difusión." };
  }
  revalidatePath("/crm");
  return { success: true, id: data.id };
}

// ───────────────────────────── Cancelar

/**
 * Frena una difusión.
 *
 * - **Programada**: vuelve a borrador. No salió nada, así que no hay nada que
 *   "cancelar": se puede corregir y volver a programar.
 * - **Saliendo**: queda cancelada. Las destinatarias que no se procesaron se
 *   cierran como omitidas, y los mensajes que estaban en la cola sin salir se
 *   anulan con `revoked_at` —el mismo mecanismo que usa la bandeja para
 *   cancelar un envío—. Lo que Meta ya recibió no tiene vuelta atrás: la
 *   Cloud API no permite borrar mensajes.
 */
export async function cancelBroadcastAction(
  id: string,
): Promise<BroadcastActionState & { outcome?: "draft" | "cancelled" }> {
  await requireRole("owner");
  const supabase = await createClient();

  const { data: unscheduled } = await supabase
    .from("broadcasts")
    .update({ status: "draft", scheduled_for: null })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (unscheduled) {
    revalidatePath("/crm");
    return { success: true, outcome: "draft" };
  }

  const nowIso = new Date().toISOString();
  const { data: cancelled, error } = await supabase
    .from("broadcasts")
    .update({ status: "cancelled", cancelled_at: nowIso })
    .eq("id", id)
    .eq("status", "sending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[broadcasts] cancel error:", error.message);
    return { error: "No pudimos cancelar la difusión." };
  }
  if (!cancelled) {
    return { error: "La difusión ya había terminado." };
  }

  // Las que todavía esperaban turno en la cola de la difusión.
  await supabase
    .from("broadcast_recipients")
    .update({
      status: "skipped",
      error: "Se canceló la difusión antes de que le llegara el turno.",
      processed_at: nowIso,
    })
    .eq("broadcast_id", id)
    .eq("status", "pending");

  // Las que ya tenían el mensaje en la cola de salida pero sin salir.
  const { data: queued } = await supabase
    .from("broadcast_recipients")
    .select("id, message_id, messages!inner(status, external_id)")
    .eq("broadcast_id", id)
    .eq("status", "queued")
    .eq("messages.status", "queued")
    .is("messages.external_id", null);

  const toRevoke = (queued ?? [])
    .map((r) => r.message_id)
    .filter((m): m is string => !!m);

  if (toRevoke.length > 0) {
    const { data: revoked } = await supabase
      .from("messages")
      .update({ revoked_at: nowIso })
      .in("id", toRevoke)
      // Repite el filtro: si el worker lo agarró entre la lectura y acá, ya
      // está 'sending' y no se toca (va a salir igual).
      .eq("status", "queued")
      .is("revoked_at", null)
      .select("id");

    const revokedIds = (revoked ?? []).map((m) => m.id);
    if (revokedIds.length > 0) {
      await supabase
        .from("broadcast_recipients")
        .update({
          status: "skipped",
          error: "Se canceló la difusión antes de que saliera el mensaje.",
        })
        .eq("broadcast_id", id)
        .in("message_id", revokedIds);
    }
  }

  revalidatePath("/crm");
  return { success: true, outcome: "cancelled" };
}

// ───────────────────────────── Duplicar / borrar

export async function duplicateBroadcastAction(
  id: string,
): Promise<BroadcastActionState> {
  const ctx = await requireRole("owner");
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!source) return { error: "No encontramos la difusión." };

  const name = `Copia de ${source.name}`.slice(0, 120);
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      name,
      status: "draft",
      filters: source.filters,
      send_mode: source.send_mode,
      message_body: source.message_body,
      template_name: source.template_name,
      template_language: source.template_language,
      template_params: source.template_params,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[broadcasts] duplicate error:", error?.message);
    return { error: "No pudimos duplicar la difusión." };
  }
  revalidatePath("/crm");
  return { success: true, id: data.id };
}

/**
 * Borra una difusión con su historial de destinatarias. Los mensajes que ya
 * salieron siguen en cada chat: lo que se pierde es el resumen.
 *
 * Una que está saliendo no se borra: primero hay que cancelarla, así no queda
 * una cola huérfana a mitad de envío.
 */
export async function deleteBroadcastAction(
  id: string,
): Promise<BroadcastActionState> {
  await requireRole("owner");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("broadcasts")
    .delete()
    .eq("id", id)
    .neq("status", "sending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[broadcasts] delete error:", error.message);
    return { error: "No pudimos borrar la difusión." };
  }
  if (!data) {
    return { error: "Está saliendo: cancelala antes de borrarla." };
  }
  revalidatePath("/crm");
  return { success: true };
}

// ───────────────────────────── Lecturas para el panel

/** La lista con números, para el sondeo mientras hay una saliendo. */
export async function listBroadcastsAction(): Promise<{
  broadcasts?: BroadcastWithStats[];
  error?: string;
}> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  return { broadcasts: await loadBroadcastsWithStats(supabase) };
}

/** Tope del detalle. Una difusión más grande se ve resumida en la tarjeta. */
const RECIPIENTS_LIMIT = 2000;

type RecipientQueryRow = {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  error: string | null;
  conversation_id: string | null;
  processed_at: string | null;
  messages: { status: string; error: string | null } | null;
};

export async function broadcastRecipientsAction(id: string): Promise<{
  recipients?: BroadcastRecipientView[];
  truncated?: boolean;
  error?: string;
}> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("broadcast_recipients")
    .select(
      "id, full_name, phone, status, error, conversation_id, processed_at, messages(status, error)",
    )
    .eq("broadcast_id", id)
    .order("created_at")
    .order("id")
    .limit(RECIPIENTS_LIMIT);

  if (error) {
    console.error("[broadcasts] recipients error:", error.message);
    return { error: "No pudimos cargar las destinatarias." };
  }

  const rows = (data ?? []) as unknown as RecipientQueryRow[];
  return {
    truncated: rows.length === RECIPIENTS_LIMIT,
    recipients: rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      status: r.status,
      error: r.error,
      conversationId: r.conversation_id,
      processedAt: r.processed_at,
      messageStatus: r.messages?.status ?? null,
      messageError: r.messages?.error ?? null,
    })),
  };
}
