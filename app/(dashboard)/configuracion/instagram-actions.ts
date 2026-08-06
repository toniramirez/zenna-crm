"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  exchangeForLongLivedToken,
  fetchOwnProfile,
  InstagramApiError,
} from "@/lib/instagram/client";
import { appSecret, IG_ACCOUNT_ID } from "@/lib/instagram/config";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionState = { error?: string; success?: boolean };

/**
 * Todas estas acciones usan el cliente service_role porque
 * `instagram_accounts` está cerrada por RLS: guarda el token de acceso y no
 * queremos que sea legible con la publishable key desde el browser.
 * El chequeo de permisos lo hace `requireRole("owner")` acá arriba.
 */

function describe(err: unknown): string {
  if (err instanceof InstagramApiError) {
    if (err.code === 190) return "El token no es válido o ya venció.";
    if (err.code === 10 || err.code === 200) {
      return "Al token le faltan permisos. Revisá que la app tenga instagram_business_manage_messages.";
    }
    return `Meta rechazó la conexión: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Conecta la cuenta a partir de un token pegado a mano.
 *
 * Para un solo salón con una sola cuenta esto es más simple y más robusto que
 * montar el flujo OAuth completo: no hace falta exponer un redirect URI ni
 * manejar el intercambio de códigos. El token se valida contra Meta antes de
 * guardarlo, así que no se puede guardar uno roto.
 */
export async function connectInstagramAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const token = String(formData.get("access_token") ?? "").trim();
  const loginType = String(formData.get("login_type") ?? "instagram");

  if (!token) return { error: "Pegá el token de acceso." };
  if (loginType !== "instagram" && loginType !== "facebook") {
    return { error: "Tipo de login inválido." };
  }

  const supabase = createServiceClient();

  try {
    let accessToken = token;
    let expiresAt: string | null = null;

    // Instagram Login: si tenemos el app secret, cambiamos el token corto por
    // uno de 60 días. Si el que pegaron ya es largo, Meta responde con error y
    // seguimos con el original — es un intento oportunista, no un requisito.
    const secret = appSecret();
    if (loginType === "instagram" && secret) {
      try {
        const exchanged = await exchangeForLongLivedToken({
          shortLivedToken: token,
          appSecret: secret,
        });
        accessToken = exchanged.access_token;
        expiresAt = new Date(
          Date.now() + exchanged.expires_in * 1000,
        ).toISOString();
      } catch {
        // Ya era de larga duración (o el secret no aplica). Sin drama.
      }
    }

    // La prueba de fuego: si Meta nos dice quiénes somos, el token sirve.
    const profile = await fetchOwnProfile({ accessToken, loginType });
    const igUserId = profile.user_id ?? profile.id ?? null;

    if (!igUserId) {
      return {
        error:
          "Meta aceptó el token pero no devolvió el ID de la cuenta. Verificá que sea una cuenta profesional (Empresa o Creador).",
      };
    }

    const { error } = await supabase
      .from("instagram_accounts")
      .upsert(
        {
          account_id: IG_ACCOUNT_ID,
          ig_user_id: igUserId,
          username: profile.username ?? profile.name ?? null,
          access_token: accessToken,
          token_expires_at: expiresAt,
          login_type: loginType,
          state: "connected",
          last_error: null,
          last_connected_at: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );

    if (error) {
      console.error("[instagram] upsert error:", error.code, error.message);
      // Mostramos la causa real y no un "algo salió mal": este panel es
      // owner-only y sin el detalle no hay forma de distinguir una key mal
      // cargada de un problema de permisos. Mismo criterio que `devError`
      // en el panel de WhatsApp.
      return {
        error: `No pudimos guardar la cuenta${error.code ? ` (${error.code})` : ""}: ${error.message}`,
      };
    }

    revalidatePath("/configuracion");
    return { success: true };
  } catch (err) {
    return { error: describe(err) };
  }
}

/** Borra el token. No revoca nada del lado de Meta — eso se hace desde la app. */
export async function disconnectInstagramAction(): Promise<ActionState> {
  await requireRole("owner");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("instagram_accounts")
    .update({
      access_token: null,
      token_expires_at: null,
      state: "disconnected",
      last_error: null,
    })
    .eq("account_id", IG_ACCOUNT_ID);

  if (error) return { error: "No pudimos desconectar la cuenta." };

  revalidatePath("/configuracion");
  return { success: true };
}

/** Revalida el token guardado contra Meta, para diagnosticar sin reconectar. */
export async function testInstagramAction(): Promise<
  ActionState & { username?: string }
> {
  await requireRole("owner");

  const supabase = createServiceClient();
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("access_token, login_type")
    .eq("account_id", IG_ACCOUNT_ID)
    .maybeSingle();

  if (!account?.access_token) return { error: "No hay ninguna cuenta conectada." };

  try {
    const profile = await fetchOwnProfile({
      accessToken: account.access_token,
      loginType: account.login_type,
    });
    await supabase
      .from("instagram_accounts")
      .update({ state: "connected", last_error: null })
      .eq("account_id", IG_ACCOUNT_ID);

    revalidatePath("/configuracion");
    return { success: true, username: profile.username ?? profile.name };
  } catch (err) {
    const message = describe(err);
    await supabase
      .from("instagram_accounts")
      .update({ state: "error", last_error: message })
      .eq("account_id", IG_ACCOUNT_ID);

    revalidatePath("/configuracion");
    return { error: message };
  }
}
