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
