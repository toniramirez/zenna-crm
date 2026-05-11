"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/validations/auth";

export type RegisterActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * Register the first owner. Server-side it double-checks no owner exists yet —
 * the DB trigger handle_new_user only auto-promotes to 'owner' if there's none,
 * but we want to fail loudly here too instead of silently creating a receptionist.
 */
export async function registerAction(
  formData: FormData,
): Promise<RegisterActionState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = await createClient();

  // Double-check: any owner already?
  const { count, error: countError } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("active", true);

  if (countError) {
    return { error: "No pudimos verificar el estado del sistema." };
  }

  if ((count ?? 0) > 0) {
    return {
      error:
        "Ya hay una dueña registrada. Pedile que te cree una cuenta desde el panel.",
    };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
      },
    },
  });

  if (error) {
    const message =
      error.message === "User already registered"
        ? "Ese email ya está registrado. Probá iniciar sesión."
        : "No pudimos crear la cuenta. Intentalo de nuevo.";
    return { error: message };
  }

  redirect("/turnos");
}
