import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export const IG_ACCOUNT_ID = "default";

/**
 * Versión de la Graph API. Meta mantiene cada versión ~2 años; cuando toque
 * subir, se cambia acá y nada más.
 */
export const IG_API_VERSION = process.env.INSTAGRAM_API_VERSION || "v25.0";

export type InstagramAccount =
  Database["public"]["Tables"]["instagram_accounts"]["Row"];

/** Lo que sí puede viajar al browser: todo menos el token. */
export type InstagramAccountPublic = Omit<InstagramAccount, "access_token"> & {
  has_token: boolean;
};

export function toPublicAccount(
  account: InstagramAccount | null,
): InstagramAccountPublic | null {
  if (!account) return null;
  const { access_token, ...rest } = account;
  return { ...rest, has_token: Boolean(access_token) };
}

/**
 * Host de la Graph API según cómo se haya conectado la cuenta:
 *   - `instagram` → Instagram API with Instagram Login. Token de usuario de
 *     Instagram, no hace falta Página de Facebook. Es el camino recomendado.
 *   - `facebook`  → Instagram API with Facebook Login. Token de Página.
 */
export function graphHost(loginType: string): string {
  return loginType === "facebook"
    ? "https://graph.facebook.com"
    : "https://graph.instagram.com";
}

export function graphUrl(loginType: string, path: string): string {
  return `${graphHost(loginType)}/${IG_API_VERSION}/${path.replace(/^\//, "")}`;
}

/**
 * App secret de la app de Meta. Solo se usa para validar la firma
 * `X-Hub-Signature-256` de los webhooks; nunca sale del servidor.
 */
export function appSecret(): string | null {
  return process.env.INSTAGRAM_APP_SECRET || null;
}

/** Token acordado con Meta para el handshake de verificación del webhook. */
export function verifyToken(): string | null {
  return process.env.INSTAGRAM_VERIFY_TOKEN || null;
}

export async function loadAccount(
  supabase: SupabaseClient<Database>,
): Promise<InstagramAccount | null> {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("account_id", IG_ACCOUNT_ID)
    .maybeSingle();

  if (error) {
    console.error("[instagram] loadAccount error:", error.message);
    return null;
  }
  return data;
}

/** Cuenta lista para enviar: conectada, con token y con IG-ID. */
export function isSendable(
  account: InstagramAccount | null,
): account is InstagramAccount & { access_token: string; ig_user_id: string } {
  return Boolean(
    account?.access_token && account.ig_user_id && account.state === "connected",
  );
}
