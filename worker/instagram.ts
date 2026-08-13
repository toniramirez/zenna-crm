import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  attachmentMessage,
  InstagramApiError,
  refreshLongLivedToken,
  sendMessage,
  sendReaction,
  textMessage,
} from "@/lib/instagram/client";
import {
  IG_ACCOUNT_ID,
  isSendable,
  loadAccount,
  type InstagramAccount,
} from "@/lib/instagram/config";
import type { Database } from "@/types/database.types";

/**
 * Worker de salida de Instagram.
 *
 * Drena la misma cola que el worker de WhatsApp — filas en `messages` con
 * status='queued' — pero solo las de conversaciones con channel='instagram'.
 * Gracias a eso, todo lo que ya encola mensajes (la bandeja, las automatizaciones,
 * los envíos masivos) funciona en Instagram sin tocar una línea.
 *
 * Corre aparte del de Baileys porque no comparte nada con él: acá no hay socket
 * ni sesión que mantener, solo llamadas HTTPS. Un WhatsApp caído no debería
 * frenar los DMs, ni al revés.
 */

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 10;

/** Ventana estándar de Messenger: 24 h desde el último mensaje de la persona. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Margen para renovar el token antes de que venza (Meta los emite a 60 días). */
const TOKEN_REFRESH_MARGIN_MS = 10 * 24 * 60 * 60 * 1000;
const TOKEN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Las URLs firmadas tienen que sobrevivir a que Meta baje el archivo. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const BUCKET = "wa-media";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL no está configurada.");
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY no está configurada.");
  process.exit(1);
}

const supabase: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type QueuedMessage = {
  id: string;
  conversation_id: string;
  type: Database["public"]["Enums"]["message_type"];
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  reaction_target_external_id: string | null;
  conversations: { external_id: string; channel: string } | null;
};

// ─────────────────────────────────────────── Helpers

/**
 * Meta descarga el adjunto por su cuenta, así que necesita una URL que pueda
 * abrir sin credenciales. El bucket es privado → firmamos temporalmente.
 */
async function signedMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error("[instagram] no pudimos firmar la URL:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * ¿Seguimos dentro de la ventana de 24 h?
 *
 * Fuera de ella Meta exige una etiqueta; usamos HUMAN_AGENT, que es la que
 * corresponde cuando contesta una persona y estira el plazo a 7 días.
 */
async function isOutsideReplyWindow(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("messages")
    .select("sent_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.sent_at) return true; // Nunca escribieron: no hay ventana abierta.
  return Date.now() - new Date(data.sent_at).getTime() > REPLY_WINDOW_MS;
}

function attachmentTypeFor(
  type: Database["public"]["Enums"]["message_type"],
): "image" | "video" | "audio" | "file" | null {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
      return "file";
    default:
      return null;
  }
}

// ─────────────────────────────────────────── Envío

async function sendQueued(
  m: QueuedMessage,
  recipientId: string,
  account: InstagramAccount & { access_token: string; ig_user_id: string },
): Promise<string | null> {
  if (m.type === "reaction") {
    if (!m.reaction_target_external_id) {
      throw new Error("Reacción sin mensaje de destino.");
    }
    const result = await sendReaction({
      account,
      recipientId,
      targetMessageId: m.reaction_target_external_id,
      // Body vacío = quitar la reacción (misma convención que WhatsApp).
      remove: !m.body || m.body.trim().length === 0,
    });
    return result.message_id ?? null;
  }

  if (m.type === "sticker") {
    // Instagram no acepta stickers arbitrarios en el envío.
    throw new Error("Instagram no permite enviar stickers.");
  }

  const humanAgentTag = await isOutsideReplyWindow(m.conversation_id);

  if (m.type !== "text") {
    const attachmentType = attachmentTypeFor(m.type);
    if (!attachmentType) {
      throw new Error(`Tipo no soportado en Instagram: ${m.type}`);
    }
    if (!m.media_url) throw new Error("Mensaje de media sin archivo.");

    const url = await signedMediaUrl(m.media_url);
    if (!url) throw new Error("No pudimos generar la URL del archivo.");

    const result = await sendMessage({
      account,
      recipientId,
      message: attachmentMessage(attachmentType, url),
      humanAgentTag,
    });

    // Instagram no soporta epígrafe junto al adjunto: si hay texto, va en un
    // segundo mensaje. Mismo criterio que usa el worker de WhatsApp con los PDF.
    const caption = m.body?.trim();
    if (caption) {
      await sendMessage({
        account,
        recipientId,
        message: textMessage(caption),
        humanAgentTag,
      });
    }
    return result.message_id ?? null;
  }

  if (!m.body) throw new Error("Mensaje de texto sin contenido.");
  const result = await sendMessage({
    account,
    recipientId,
    message: textMessage(m.body),
    humanAgentTag,
  });
  return result.message_id ?? null;
}

async function pollOutgoing(): Promise<void> {
  const account = await loadAccount(supabase);
  if (!isSendable(account)) return;

  const { data: queued, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, type, body, media_url, media_mime, media_filename, reaction_target_external_id, conversations!inner(external_id, channel)",
    )
    .eq("status", "queued")
    .eq("direction", "outbound")
    .eq("conversations.channel", "instagram")
    // Envío cancelado desde la bandeja antes de salir: queda 'queued' con
    // `revoked_at` puesto para que nunca se mande.
    .is("revoked_at", null)
    .order("sent_at")
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[instagram] select error:", error.message);
    return;
  }
  if (!queued || queued.length === 0) return;

  for (const m of queued as unknown as QueuedMessage[]) {
    const conversation = m.conversations;
    if (!conversation || conversation.channel !== "instagram") continue;

    // Claim optimista: el UPDATE condicionado a status='queued' garantiza que
    // solo un worker se quede con el mensaje aunque haya varias instancias.
    const { data: claim } = await supabase
      .from("messages")
      .update({ status: "sending" })
      .eq("id", m.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claim) continue;

    try {
      const externalId = await sendQueued(m, conversation.external_id, account);

      await supabase
        .from("messages")
        .update({
          status: "sent",
          external_id: externalId,
          sent_at: new Date().toISOString(),
        })
        .eq("id", m.id);

      console.log("→ IG enviado", m.type, m.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent =
        !(err instanceof InstagramApiError) || err.isPermanent;

      // Un fallo transitorio (red, 500 de Meta) vuelve a 'queued' y se
      // reintenta solo en la próxima vuelta. Uno permanente queda 'failed'
      // para que se vea en la bandeja y no se reintente para siempre.
      await supabase
        .from("messages")
        .update(
          permanent
            ? {
                status: "failed",
                error: message.slice(0, 500),
                failed_at: new Date().toISOString(),
              }
            : { status: "queued", error: message.slice(0, 500) },
        )
        .eq("id", m.id);

      console.error(
        `→ IG falló ${m.id} (${permanent ? "permanente" : "reintentable"}):`,
        message,
      );

      if (err instanceof InstagramApiError && err.code === 190) {
        // Token muerto: dejarlo marcado para que el panel lo muestre.
        await supabase
          .from("instagram_accounts")
          .update({
            state: "error",
            last_error: "El token de acceso venció o fue revocado.",
          })
          .eq("account_id", IG_ACCOUNT_ID);
      }
    }
  }
}

// ─────────────────────────────────────────── Renovación de token

/**
 * Los tokens de larga duración duran 60 días. Si se vencen hay que reconectar
 * la cuenta a mano desde Configuración, así que renovamos con margen.
 * Solo aplica a Instagram Login; los tokens de Página no se refrescan así.
 */
async function refreshTokenIfNeeded(): Promise<void> {
  const account = await loadAccount(supabase);
  if (!account?.access_token || account.login_type !== "instagram") return;
  if (!account.token_expires_at) return;

  const msLeft = new Date(account.token_expires_at).getTime() - Date.now();
  if (msLeft > TOKEN_REFRESH_MARGIN_MS) return;

  try {
    const refreshed = await refreshLongLivedToken(account.access_token);
    const expiresAt = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();

    await supabase
      .from("instagram_accounts")
      .update({
        access_token: refreshed.access_token,
        token_expires_at: expiresAt,
        state: "connected",
        last_error: null,
      })
      .eq("account_id", IG_ACCOUNT_ID);

    console.log("🔑 Token de Instagram renovado hasta", expiresAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[instagram] no pudimos renovar el token:", message);
    await supabase
      .from("instagram_accounts")
      .update({ last_error: `No pudimos renovar el token: ${message}` })
      .eq("account_id", IG_ACCOUNT_ID);
  }
}

// ─────────────────────────────────────────── Arranque

console.log("📷 Worker de Instagram arriba. Escuchando la cola de salida…");

// `void` en vez de await: si una vuelta falla, la siguiente sigue corriendo.
setInterval(() => void pollOutgoing(), POLL_INTERVAL_MS);
setInterval(() => void refreshTokenIfNeeded(), TOKEN_CHECK_INTERVAL_MS);
void refreshTokenIfNeeded();
