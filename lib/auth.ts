import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];

type AuthContext = {
  profile: Profile;
  userId: string;
  email: string;
};

/**
 * Server-side helper. Loads the current authenticated user + their profile row.
 * Redirects to /login if there's no session, or /login if the profile is missing
 * (which would mean the auth.users row exists but the trigger never fired —
 * shouldn't happen in practice, but we guard against it).
 *
 * Va envuelto en `cache()` de React: en una misma navegación esto se llama al
 * menos dos veces —el layout del dashboard pide el perfil para el rail y la
 * página pide el rol con `requireRole`— y cada llamada eran dos viajes de red
 * a Supabase (`getUser` contra el servidor de Auth + la fila de `profiles`).
 * Con el caché por request el segundo llamado es gratis. `cache()` dura lo que
 * dura el render de una request: no comparte nada entre usuarias ni entre
 * navegaciones, así que no hay riesgo de servir el perfil de otra.
 */
export const requireProfile = cache(async function requireProfile(): Promise<AuthContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  return { profile, userId: user.id, email: user.email ?? "" };
});

/**
 * Hard-block a route to specific roles. Throws (via redirect) for anyone else.
 * Use at the top of Server Components / Server Actions that should be role-gated.
 */
export async function requireRole(allowed: AppRole | AppRole[]): Promise<AuthContext> {
  const ctx = await requireProfile();
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedList.includes(ctx.profile.role)) {
    redirect("/turnos");
  }
  return ctx;
}
