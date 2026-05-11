"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";

export type LoginActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function loginAction(
  redirectTo: string,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
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
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Map common Supabase errors to friendlier Spanish messages
    const message =
      error.message === "Invalid login credentials"
        ? "Email o contraseña incorrectos."
        : error.message === "Email not confirmed"
          ? "El email todavía no está confirmado. Revisá tu casilla."
          : "No pudimos iniciar sesión. Intentalo de nuevo.";
    return { error: message };
  }

  // Validate the redirect target is a same-origin path before honoring it
  const safeTarget =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/turnos";

  redirect(safeTarget);
}
