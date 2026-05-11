import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Server-side helper. Loads the current authenticated user + their profile row.
 * Redirects to /login if there's no session, or /login if the profile is missing
 * (which would mean the auth.users row exists but the trigger never fired —
 * shouldn't happen in practice, but we guard against it).
 */
export async function requireProfile(): Promise<{
  profile: Profile;
  userId: string;
  email: string;
}> {
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
}

/**
 * Hard-block a route to specific roles. Throws (via redirect) for anyone else.
 * Use at the top of Server Components / Server Actions that should be role-gated.
 */
export async function requireRole(allowed: AppRole | AppRole[]): Promise<{
  profile: Profile;
  userId: string;
  email: string;
}> {
  const ctx = await requireProfile();
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedList.includes(ctx.profile.role)) {
    redirect("/turnos");
  }
  return ctx;
}
