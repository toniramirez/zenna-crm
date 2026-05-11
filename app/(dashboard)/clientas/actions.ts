"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clientSchema, parseTagsString } from "@/lib/validations/clients";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";
import type { Database } from "@/types/database.types";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

export type QuickClient = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "full_name" | "phone"
>;

/**
 * Fast-path client creation used from the appointment dialog when the
 * receptionist needs to add a walk-in without leaving the booking flow.
 * Only name + optional phone — the full ficha capilar / tags can be filled
 * later from /clientas.
 */
export async function createClientQuickAction(
  name: string,
  phone: string,
): Promise<{ client?: QuickClient; error?: string }> {
  await requireRole(["owner", "receptionist"]);

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();

  if (trimmedName.length < 2) {
    return { error: "El nombre es muy corto." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      full_name: trimmedName,
      phone: trimmedPhone || null,
      tags: [],
    })
    .select("id, full_name, phone")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una clienta con ese teléfono." };
    }
    return { error: "No pudimos crear la clienta." };
  }

  revalidatePath("/clientas");
  return { client: data };
}

function payloadFrom(formData: FormData) {
  const tagsRaw = formData.get("tags");
  const tags =
    typeof tagsRaw === "string" ? parseTagsString(tagsRaw) : [];

  return clientSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    instagramHandle: formData.get("instagramHandle") || undefined,
    birthday: formData.get("birthday") || undefined,
    hairNotes: formData.get("hairNotes") || undefined,
    notes: formData.get("notes") || undefined,
    tags,
  });
}

function toRow(parsed: ReturnType<typeof payloadFrom>) {
  if (!parsed.success) throw new Error("invalid");
  const d = parsed.data;
  return {
    full_name: d.fullName,
    phone: d.phone || null,
    email: d.email || null,
    instagram_handle: d.instagramHandle || null,
    birthday: d.birthday || null,
    hair_notes: d.hairNotes || null,
    notes: d.notes || null,
    tags: d.tags,
  };
}

export async function createClientAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = payloadFrom(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("clients").insert(toRow(parsed));

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una clienta con ese teléfono." };
    }
    return { error: "No pudimos crear la clienta." };
  }

  revalidatePath("/clientas");
  return { success: true };
}

export async function updateClientAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = payloadFrom(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update(toRow(parsed))
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una clienta con ese teléfono." };
    }
    return { error: "No pudimos guardar los cambios." };
  }

  revalidatePath("/clientas");
  return { success: true };
}
