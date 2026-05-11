"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  automationFlowSchema,
  clientTagSchema,
  paymentMethodSchema,
  quickReplySchema,
} from "@/lib/validations/crm-config";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

// ──────────────────── Tags ────────────────────

function parseTag(formData: FormData) {
  return clientTagSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    active: formData.get("active") === "true",
  });
}

export async function createTagAction(formData: FormData): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseTag(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("client_tags").insert({
    name: parsed.data.name.trim(),
    color: parsed.data.color,
    active: parsed.data.active,
  });
  if (error) {
    if (error.code === "23505")
      return { error: "Ya existe una etiqueta con ese nombre." };
    return { error: "No pudimos crear la etiqueta." };
  }
  revalidatePath("/crm");
  return { success: true };
}

export async function updateTagAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseTag(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_tags")
    .update({
      name: parsed.data.name.trim(),
      color: parsed.data.color,
      active: parsed.data.active,
    })
    .eq("id", id);
  if (error) return { error: "No pudimos guardar los cambios." };
  revalidatePath("/crm");
  return { success: true };
}

export async function deleteTagAction(id: string): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  // Soft-delete: only deactivate; preserves any existing tag references
  // on clients without breaking historical data.
  const { error } = await supabase
    .from("client_tags")
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: "No pudimos archivar la etiqueta." };
  revalidatePath("/crm");
  return { success: true };
}

// ──────────────────── Quick replies ────────────────────

function parseQuickReply(formData: FormData) {
  return quickReplySchema.safeParse({
    label: formData.get("label"),
    body: formData.get("body"),
    shortcut: formData.get("shortcut") || undefined,
    active: formData.get("active") === "true",
  });
}

export async function createQuickReplyAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseQuickReply(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("quick_replies").insert({
    label: parsed.data.label.trim(),
    body: parsed.data.body,
    shortcut: parsed.data.shortcut?.trim() || null,
    active: parsed.data.active,
  });
  if (error) {
    if (error.code === "23505")
      return { error: "Ya existe un mensaje rápido con ese atajo." };
    return { error: "No pudimos crear el mensaje rápido." };
  }
  revalidatePath("/crm");
  return { success: true };
}

export async function updateQuickReplyAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseQuickReply(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_replies")
    .update({
      label: parsed.data.label.trim(),
      body: parsed.data.body,
      shortcut: parsed.data.shortcut?.trim() || null,
      active: parsed.data.active,
    })
    .eq("id", id);
  if (error) return { error: "No pudimos guardar los cambios." };
  revalidatePath("/crm");
  return { success: true };
}

export async function deleteQuickReplyAction(id: string): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_replies")
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: "No pudimos archivar el mensaje rápido." };
  revalidatePath("/crm");
  return { success: true };
}

// ──────────────────── Automation flows ────────────────────

function parseFlow(formData: FormData) {
  const ids = formData.get("serviceFilterIds");
  const serviceFilterIds =
    typeof ids === "string" && ids.length > 0
      ? ids.split(",").filter((s) => s.length > 0)
      : [];

  return automationFlowSchema.safeParse({
    name: formData.get("name"),
    trigger: formData.get("trigger"),
    triggerOffsetMinutes: Number(formData.get("triggerOffsetMinutes") ?? 0),
    serviceFilterIds,
    messageBody: formData.get("messageBody"),
    active: formData.get("active") === "true",
  });
}

export async function createFlowAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseFlow(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("automation_flows").insert({
    name: parsed.data.name.trim(),
    trigger: parsed.data.trigger,
    trigger_offset_minutes: parsed.data.triggerOffsetMinutes,
    service_filter_ids: parsed.data.serviceFilterIds,
    message_body: parsed.data.messageBody,
    active: parsed.data.active,
  });
  if (error) return { error: "No pudimos crear el flujo." };
  revalidatePath("/crm");
  return { success: true };
}

export async function updateFlowAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parseFlow(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_flows")
    .update({
      name: parsed.data.name.trim(),
      trigger: parsed.data.trigger,
      trigger_offset_minutes: parsed.data.triggerOffsetMinutes,
      service_filter_ids: parsed.data.serviceFilterIds,
      message_body: parsed.data.messageBody,
      active: parsed.data.active,
    })
    .eq("id", id);
  if (error) return { error: "No pudimos guardar los cambios." };
  revalidatePath("/crm");
  return { success: true };
}

export async function deleteFlowAction(id: string): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  // Hard-delete: pending executions cascade. Already-sent ones stay (FK is
  // ON DELETE CASCADE on executions → if user really wants to delete a
  // historical flow, they accept losing the execution log).
  const { error } = await supabase
    .from("automation_flows")
    .delete()
    .eq("id", id);
  if (error) return { error: "No pudimos eliminar el flujo." };
  revalidatePath("/crm");
  return { success: true };
}

// ──────────────────── Payment methods ────────────────────

function parsePaymentMethod(formData: FormData) {
  const installmentsRaw = formData.get("installments");
  const installments =
    typeof installmentsRaw === "string" && installmentsRaw.length > 0
      ? Number(installmentsRaw)
      : null;
  return paymentMethodSchema.safeParse({
    label: formData.get("label"),
    surchargePercent: Number(formData.get("surchargePercent") ?? 0),
    installments,
    active: formData.get("active") === "true",
  });
}

export async function createPaymentMethodAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parsePaymentMethod(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("payment_methods").insert({
    label: parsed.data.label.trim(),
    surcharge_percent: parsed.data.surchargePercent,
    installments: parsed.data.installments,
    active: parsed.data.active,
  });
  if (error) {
    if (error.code === "23505")
      return { error: "Ya existe un medio de pago con ese nombre." };
    return { error: "No pudimos crear el medio de pago." };
  }
  revalidatePath("/crm");
  return { success: true };
}

export async function updatePaymentMethodAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");
  const parsed = parsePaymentMethod(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_methods")
    .update({
      label: parsed.data.label.trim(),
      surcharge_percent: parsed.data.surchargePercent,
      installments: parsed.data.installments,
      active: parsed.data.active,
    })
    .eq("id", id);
  if (error) {
    if (error.code === "23505")
      return { error: "Ya existe un medio de pago con ese nombre." };
    return { error: "No pudimos guardar los cambios." };
  }
  revalidatePath("/crm");
  return { success: true };
}

export async function deletePaymentMethodAction(
  id: string,
): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  // Soft-delete: preserve historical references on budget_payment_options.
  const { error } = await supabase
    .from("payment_methods")
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: "No pudimos archivar el medio de pago." };
  revalidatePath("/crm");
  return { success: true };
}
