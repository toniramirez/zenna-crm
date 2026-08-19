import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export const WA_CLOUD_ACCOUNT_ID = "default";

/**
 * Versión de la Graph API. Meta mantiene cada versión ~2 años; cuando toque
 * subir, se cambia acá y nada más. Es la misma numeración que usa Instagram.
 */
export const WA_CLOUD_API_VERSION =
  process.env.WHATSAPP_API_VERSION || "v25.0";

export type WhatsappCloudAccount =
  Database["public"]["Tables"]["whatsapp_cloud_accounts"]["Row"];

/** Lo que sí puede viajar al browser: todo menos el token. */
export type WhatsappCloudAccountPublic = Omit<
  WhatsappCloudAccount,
  "access_token"
> & {
  has_token: boolean;
};

export function toPublicAccount(
  account: WhatsappCloudAccount | null,
): WhatsappCloudAccountPublic | null {
  if (!account) return null;
  const { access_token, ...rest } = account;
  return { ...rest, has_token: Boolean(access_token) };
}

/** La Cloud API vive siempre en graph.facebook.com, sin variantes de login. */
export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${WA_CLOUD_API_VERSION}/${path.replace(/^\//, "")}`;
}

/**
 * Secrets candidatos para validar la firma `X-Hub-Signature-256` del webhook.
 *
 * `WHATSAPP_APP_SECRET` acepta varios separados por coma, igual que
 * `INSTAGRAM_APP_SECRET`. Y si no está configurada cae en la de Instagram a
 * propósito: cuando WhatsApp e Instagram viven en la misma app de Meta —el
 * caso normal— el app secret es el mismo, y duplicar el valor en el .env solo
 * agrega una forma más de que difieran por error.
 */
export function appSecrets(): string[] {
  const raw =
    process.env.WHATSAPP_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Token acordado con Meta para el handshake de verificación del webhook.
 * Mismo fallback que los secrets: si el webhook de WhatsApp y el de Instagram
 * están en la misma app, Meta permite usar el mismo verify token en ambos.
 */
export function verifyToken(): string | null {
  return (
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
    process.env.INSTAGRAM_VERIFY_TOKEN?.trim() ||
    null
  );
}

export async function loadAccount(
  supabase: SupabaseClient<Database>,
): Promise<WhatsappCloudAccount | null> {
  const { data, error } = await supabase
    .from("whatsapp_cloud_accounts")
    .select("*")
    .eq("account_id", WA_CLOUD_ACCOUNT_ID)
    .maybeSingle();

  if (error) {
    console.error("[wa-cloud] loadAccount error:", error.message);
    return null;
  }
  return data;
}

/** Cuenta lista para enviar: conectada, con token y con phone_number_id. */
export function isSendable(
  account: WhatsappCloudAccount | null,
): account is WhatsappCloudAccount & {
  access_token: string;
  phone_number_id: string;
} {
  return Boolean(
    account?.access_token &&
      account.phone_number_id &&
      account.state === "connected",
  );
}
