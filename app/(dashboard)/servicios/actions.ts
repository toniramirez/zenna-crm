"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serviceSchema } from "@/lib/validations/services";

export type ServiceActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

function parseFormData(formData: FormData) {
  return serviceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    category: formData.get("category"),
    durationMinutes: Number(formData.get("durationMinutes")),
    price: Number(formData.get("price")),
    active: formData.get("active") === "true",
  });
}

function fieldErrorsFrom(parsed: ReturnType<typeof parseFormData>) {
  if (parsed.success) return undefined;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]?.toString();
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function createServiceAction(
  formData: FormData,
): Promise<ServiceActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = parseFormData(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("services").insert({
    name: parsed.data.name,
    description: parsed.data.description || null,
    category: parsed.data.category,
    duration_minutes: parsed.data.durationMinutes,
    price: parsed.data.price,
    active: parsed.data.active,
  });

  if (error) {
    return { error: "No pudimos crear el servicio. Intentalo de nuevo." };
  }

  revalidatePath("/servicios");
  return { success: true };
}

export async function updateServiceAction(
  id: string,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireRole(["owner", "receptionist"]);

  const parsed = parseFormData(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      category: parsed.data.category,
      duration_minutes: parsed.data.durationMinutes,
      price: parsed.data.price,
      active: parsed.data.active,
    })
    .eq("id", id);

  if (error) {
    return { error: "No pudimos guardar los cambios. Intentalo de nuevo." };
  }

  revalidatePath("/servicios");
  return { success: true };
}

export async function toggleServiceActiveAction(id: string, active: boolean) {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ active })
    .eq("id", id);

  if (error) {
    return { error: "No pudimos cambiar el estado del servicio." };
  }

  revalidatePath("/servicios");
  return { success: true };
}

/**
 * Soft-delete: we just deactivate. We don't hard-delete because services may
 * be referenced by historical appointment_services rows (FK with ON DELETE
 * RESTRICT), and we want the booking history to stay intact.
 */
export async function deleteServiceAction(id: string) {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ active: false })
    .eq("id", id);

  if (error) {
    return { error: "No pudimos archivar el servicio." };
  }

  revalidatePath("/servicios");
  redirect("/servicios");
}
