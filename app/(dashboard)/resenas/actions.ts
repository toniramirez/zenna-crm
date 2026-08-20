"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionState = {
  error?: string;
  success?: boolean;
};

/**
 * Cierra el caso interno que abrió un puntaje bajo. Guarda además la nota de
 * lo que se hizo: sin eso "resuelto" no dice nada dentro de un mes, que es
 * cuando la clienta vuelve y alguien necesita saber qué pasó la vez anterior.
 */
export async function resolveCaseAction(
  id: string,
  notes: string,
): Promise<ActionState> {
  const { userId } = await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("review_requests")
    .update({
      case_status: "resolved",
      case_notes: notes.trim() || null,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", id);

  if (error) return { error: "No pudimos cerrar el caso." };
  revalidatePath("/resenas");
  return { success: true };
}

/** Vuelve a abrir un caso cerrado por error. */
export async function reopenCaseAction(id: string): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("review_requests")
    .update({
      case_status: "open",
      resolved_at: null,
      resolved_by: null,
    })
    .eq("id", id);

  if (error) return { error: "No pudimos reabrir el caso." };
  revalidatePath("/resenas");
  return { success: true };
}

/** Anota sin cerrar: sirve mientras el caso todavía se está resolviendo. */
export async function saveCaseNotesAction(
  id: string,
  notes: string,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("review_requests")
    .update({ case_notes: notes.trim() || null })
    .eq("id", id);

  if (error) return { error: "No pudimos guardar la nota." };
  revalidatePath("/resenas");
  return { success: true };
}
