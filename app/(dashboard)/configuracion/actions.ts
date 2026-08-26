"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SESSION_ID = "default";

export type ActionState = { error?: string; success?: boolean };

function devError(prefix: string, error: { code?: string; message?: string }) {
  console.error(`[configuracion] ${prefix}:`, error.code, error.message);
  if (process.env.NODE_ENV !== "production") {
    return `${prefix}${error.code ? ` (${error.code})` : ""}: ${error.message ?? "desconocido"}`;
  }
  return prefix;
}

export async function requestWhatsappLogoutAction(): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_status")
    .upsert(
      { session_id: SESSION_ID, state: "logout_requested" },
      { onConflict: "session_id" },
    );
  if (error) {
    return { error: devError("No pudimos solicitar el cierre de sesión", error) };
  }
  revalidatePath("/configuracion");
  return { success: true };
}

export async function requestWhatsappReconnectAction(): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_status")
    .upsert(
      {
        session_id: SESSION_ID,
        state: "reconnect_requested",
        last_error: null,
      },
      { onConflict: "session_id" },
    );
  if (error) {
    return { error: devError("No pudimos solicitar la reconexión", error) };
  }
  revalidatePath("/configuracion");
  return { success: true };
}

/**
 * Hard reset — force the state back to `disconnected` regardless of where it
 * was. Used when the worker is offline and the UI gets stuck on an
 * intermediate state (connecting / reconnect_requested / logout_requested).
 * Doesn't touch the actual WhatsApp session, just clears stale status.
 */
export async function forceDisconnectAction(): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_status")
    .upsert(
      {
        session_id: SESSION_ID,
        state: "disconnected",
        qr: null,
        last_error: "Estado forzado por la usuaria desde la UI.",
      },
      { onConflict: "session_id" },
    );
  if (error) {
    return { error: devError("No pudimos forzar el reset", error) };
  }
  revalidatePath("/configuracion");
  return { success: true };
}

// ──────────────── Redirección del número viejo ────────────────

/**
 * Guarda la respuesta automática con la que el número de Baileys manda a la
 * gente al número nuevo de la Cloud API.
 *
 * Un cooldown de 0 significa "contestar cada vez que escriban", que es lo
 * pensado para las primeras semanas de la migración: el aviso tiene que ser
 * imposible de perderse. Subirlo más adelante lo vuelve un recordatorio suave.
 */
export async function updateLegacyRedirectAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const enabled = formData.get("enabled") === "true";
  const message = String(formData.get("message") ?? "").trim();
  const number = String(formData.get("number") ?? "").trim();
  const cooldownRaw = Number(formData.get("cooldownMinutes") ?? 0);
  const cooldown =
    Number.isFinite(cooldownRaw) && cooldownRaw >= 0
      ? Math.min(Math.round(cooldownRaw), 43200)
      : 0;

  if (enabled && message.length < 5) {
    return { error: "Escribí el mensaje de redirección." };
  }
  if (message.length > 4000) {
    return { error: "El mensaje es demasiado largo." };
  }
  // Es el dato que hace útil al aviso: sin él el mensaje diría "escribinos al"
  // y nada más. Se corta acá y también en el worker, que se calla si falta.
  if (enabled && message.includes("{{numero}}") && number.length === 0) {
    return { error: "Cargá el número nuevo, que es lo que reemplaza {{numero}}." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_legacy_settings")
    .update({
      redirect_enabled: enabled,
      redirect_message: message,
      redirect_number: number || null,
      redirect_cooldown_minutes: cooldown,
    })
    .eq("session_id", SESSION_ID);

  if (error) {
    return { error: devError("No pudimos guardar la redirección", error) };
  }

  revalidatePath("/configuracion");
  return { success: true };
}
