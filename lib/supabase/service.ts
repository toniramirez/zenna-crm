import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Cliente con service_role. Hace bypass de RLS, así que **solo** puede usarse
 * en código que corre en el servidor (route handlers, server actions, worker).
 * Nunca importarlo desde un componente "use client".
 *
 * Lo necesitamos para dos cosas que no tienen sesión de usuario:
 *   - el webhook de Instagram, que entra sin cookies;
 *   - leer/escribir `instagram_accounts`, que está bloqueada por RLS porque
 *     guarda el token de acceso.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY para el cliente service_role.",
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
