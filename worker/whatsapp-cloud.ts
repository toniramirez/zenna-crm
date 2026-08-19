import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  mediaPayload,
  reactionPayload,
  sendCloudMessage,
  templatePayload,
  textPayload,
  WhatsappApiError,
  type CloudMessagePayload,
} from "@/lib/whatsapp-cloud/client";
import {
  isSendable,
  loadAccount,
  WA_CLOUD_ACCOUNT_ID,
  type WhatsappCloudAccount,
} from "@/lib/whatsapp-cloud/config";
import { parseStoredTemplatePayload } from "@/lib/whatsapp-cloud/templates";
import type { Database } from "@/types/database.types";

/**
 * Worker de salida de la WhatsApp Cloud API (canal `whatsapp_cloud`).
 *
 * Drena la misma cola que los otros workers — filas en `messages` con
 * status='queued' — pero solo las de conversaciones con channel=
 * 'whatsapp_cloud'. Gracias a eso, todo lo que ya encola mensajes (la
 * bandeja, el selector de plantillas) funciona sin tocar una línea.
 *
 * Corre aparte del de Baileys y del de Instagram: acá no hay socket ni sesión
 * que mantener, solo llamadas HTTPS, y una caída de un canal no tiene por qué
 * frenar a los otros. Los ENTRANTES y los acuses no pasan por acá — llegan al
 * webhook de Next (app/api/whatsapp/webhook).
 */

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 10;

/**
 * A partir de acá un mensaje encolado ya no se manda: se marca fallido.
 * Mismo criterio (y misma historia) que el worker de Instagram: entregar
 * todo junto una semana tarde es peor que no entregar.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Ventana de servicio de la Cloud API: 24 h desde el último mensaje del
 * cliente. Afuera de ella Meta solo acepta plantillas aprobadas (error
 * 131047 para todo lo demás) — acá no existe el HUMAN_AGENT de Instagram.
 */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  created_at: string;
  type: Database["public"]["Enums"]["message_type"];
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  reaction_target_external_id: string | null;
  wa_template: unknown;
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
    console.error("[wa-cloud] no pudimos firmar la URL:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * ¿La ventana de 24 h está cerrada para esta conversación?
 *
 * Se excluyen las reacciones a propósito: para Meta la ventana la abre un
 * mensaje real del cliente, no un emoji sobre uno nuestro — contarlas haría
 * pasar el pre-chequeo y el envío rebotaría igual con 131047.
 */
async function isOutsideReplyWindow(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("messages")
    .select("sent_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .neq("type", "reaction")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.sent_at) return true; // Nunca escribieron: no hay ventana abierta.
  return Date.now() - new Date(data.sent_at).getTime() > REPLY_WINDOW_MS;
}

/**
 * Formatos que la Cloud API acepta por tipo. Chequearlo antes evita un viaje
 * a Meta que ya sabemos que rebota — el caso concreto: las notas de voz del
 * micrófono del CRM salen como audio/webm, que la Cloud API no acepta.
 */
const SUPPORTED_MIME: Record<string, RegExp> = {
  image: /^image\/(jpeg|png)$/,
  video: /^video\/(mp4|3gpp?)$/,
  audio: /^audio\/(aac|amr|mpeg|mp4|ogg)/,
  sticker: /^image\/webp$/,
};

function assertSendableMime(
  type: string,
  mime: string | null,
): void {
  const rule = SUPPORTED_MIME[type];
  if (!rule) return; // documentos: Meta acepta casi todo.
  if (!mime || !rule.test(mime)) {
    throw new WhatsappApiError(
      `La API de WhatsApp no acepta ${type} en formato ${mime ?? "desconocido"}.` +
        (type === "audio"
          ? " Las notas de voz grabadas en el CRM (webm) todavía no se pueden mandar por este canal."
          : ""),
      400,
    );
  }
}

// ─────────────────────────────────────────── Envío

async function buildPayload(m: QueuedMessage): Promise<CloudMessagePayload> {
  // Plantilla: el payload quedó guardado al encolar; se manda tal cual.
  const template = parseStoredTemplatePayload(m.wa_template);
  if (m.wa_template && !template) {
    throw new WhatsappApiError("El payload de la plantilla está roto.", 400);
  }
  if (template) return templatePayload(template);

  if (m.type === "reaction") {
    if (!m.reaction_target_external_id) {
      throw new WhatsappApiError("Reacción sin mensaje de destino.", 400);
    }
    return reactionPayload(m.reaction_target_external_id, m.body?.trim() ?? "");
  }

  if (m.type === "text") {
    if (!m.body) throw new WhatsappApiError("Mensaje de texto sin contenido.", 400);
    return textPayload(m.body);
  }

  if (
    m.type === "image" ||
    m.type === "video" ||
    m.type === "audio" ||
    m.type === "document" ||
    m.type === "sticker"
  ) {
    if (!m.media_url) {
      throw new WhatsappApiError("Mensaje de media sin archivo.", 400);
    }
    assertSendableMime(m.type, m.media_mime);

    const link = await signedMediaUrl(m.media_url);
    if (!link) {
      // Storage caído es transitorio: status 0 lo devuelve a la cola.
      throw new WhatsappApiError("No pudimos generar la URL del archivo.", 0);
    }
    return mediaPayload({
      type: m.type,
      link,
      caption: m.body,
      filename: m.media_filename,
    });
  }

  throw new WhatsappApiError(`Tipo no soportado en la Cloud API: ${m.type}`, 400);
}

async function pollOutgoing(): Promise<void> {
  const account = await loadAccount(supabase);
  if (!isSendable(account)) return;

  const { data: queued, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, created_at, type, body, media_url, media_mime, media_filename, reaction_target_external_id, wa_template, conversations!inner(external_id, channel)",
    )
    .eq("status", "queued")
    .eq("direction", "outbound")
    .eq("conversations.channel", "whatsapp_cloud")
    // Envío cancelado desde la bandeja antes de salir: queda 'queued' con
    // `revoked_at` puesto para que nunca se mande.
    .is("revoked_at", null)
    .order("sent_at")
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[wa-cloud] select error:", error.message);
    return;
  }
  if (!queued || queued.length === 0) return;

  for (const m of queued as unknown as QueuedMessage[]) {
    const conversation = m.conversations;
    if (!conversation || conversation.channel !== "whatsapp_cloud") continue;

    // Demasiado viejo para mandarlo (ver STALE_AFTER_MS).
    const ageMs = Date.now() - new Date(m.created_at).getTime();
    if (ageMs > STALE_AFTER_MS) {
      const hours = Math.floor(ageMs / 3_600_000);
      await supabase
        .from("messages")
        .update({
          status: "failed",
          error: `No se envió: quedó encolado ${hours} h porque el worker de WhatsApp API estaba caído.`,
          failed_at: new Date().toISOString(),
        })
        .eq("id", m.id)
        .eq("status", "queued");
      console.warn(`→ WA-API descartado por viejo (${hours} h)`, m.id);
      continue;
    }

    // Fuera de la ventana de 24 h Meta rechaza todo lo que no sea plantilla
    // (131047). Cortarlo acá ahorra el viaje y deja un error accionable.
    const isTemplate = Boolean(m.wa_template);
    if (!isTemplate && m.type !== "reaction") {
      if (await isOutsideReplyWindow(m.conversation_id)) {
        await supabase
          .from("messages")
          .update({
            status: "failed",
            error:
              "Fuera de la ventana de 24 h: mandá una plantilla para reabrir la conversación.",
            failed_at: new Date().toISOString(),
          })
          .eq("id", m.id)
          .eq("status", "queued");
        console.warn("→ WA-API fuera de ventana", m.id);
        continue;
      }
    }

    // Claim optimista: el UPDATE condicionado a status='queued' garantiza que
    // solo un worker se quede con el mensaje aunque haya varias instancias.
    // El `.is(revoked_at, null)` repite el filtro del SELECT adrede: una
    // cancelación que llegue entre la lectura y el claim gana siempre.
    const { data: claim, error: claimError } = await supabase
      .from("messages")
      .update({ status: "sending" })
      .eq("id", m.id)
      .eq("status", "queued")
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (claimError) {
      console.error("[wa-cloud] no pudimos reclamar", m.id, claimError.message);
      continue;
    }
    if (!claim) continue;

    try {
      const payload = await buildPayload(m);
      const wamid = await sendCloudMessage({
        account,
        to: conversation.external_id,
        payload,
      });

      // Si este UPDATE falla, la fila queda 'sending' sin wamid y los acuses
      // del webhook no la encuentran — por eso se chequea y se loguea fuerte,
      // y rescueStuckSending() la marca fallida si nadie la levanta.
      const { error: doneError } = await supabase
        .from("messages")
        .update({
          status: "sent",
          external_id: wamid,
          sent_at: new Date().toISOString(),
        })
        .eq("id", m.id);
      if (doneError) {
        console.error(
          `[wa-cloud] enviado pero no pudimos guardar el estado de ${m.id} (wamid=${wamid}):`,
          doneError.message,
        );
      }

      console.log("→ WA-API enviado", isTemplate ? "template" : m.type, m.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isApiError = err instanceof WhatsappApiError;
      const permanent = !isApiError || err.isPermanent;

      const friendly =
        isApiError && err.isOutsideWindow
          ? "Fuera de la ventana de 24 h: mandá una plantilla para reabrir la conversación."
          : message;

      // Un fallo transitorio (red, 500 de Meta, rate limit) vuelve a 'queued'
      // y se reintenta solo en la próxima vuelta. Uno permanente queda
      // 'failed' para que se vea en la bandeja y no se reintente para siempre.
      await supabase
        .from("messages")
        .update(
          permanent
            ? {
                status: "failed",
                error: friendly.slice(0, 500),
                failed_at: new Date().toISOString(),
              }
            : { status: "queued", error: friendly.slice(0, 500) },
        )
        .eq("id", m.id);

      console.error(
        `→ WA-API falló ${m.id} (${permanent ? "permanente" : "reintentable"}):`,
        message,
      );

      if (isApiError && err.isAuthError) {
        // Token muerto: dejarlo marcado para que el panel lo muestre.
        await supabase
          .from("whatsapp_cloud_accounts")
          .update({
            state: "error",
            last_error: "El token de acceso venció o fue revocado.",
          })
          .eq("account_id", WA_CLOUD_ACCOUNT_ID);
      }
    }
  }
}

// ─────────────────────────────────────────── Rescate de envíos a medias

/**
 * Un mensaje que lleva demasiado en 'sending' es un envío que quedó a medias:
 * el proceso murió entre el claim y el guardado final, o ese guardado falló.
 * Nada lo vuelve a mirar solo — pollOutgoing filtra 'queued' y el webhook
 * busca por un wamid que nunca se guardó — así que acá se marca fallido con
 * el motivo a la vista. No se re-encola: si el envío en realidad salió,
 * reintentarlo duplicaría el mensaje; que decida la recepción.
 */
const STUCK_SENDING_MS = 15 * 60 * 1000;
const RESCUE_INTERVAL_MS = 60 * 1000;

async function rescueStuckSending(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_MS).toISOString();

  const { data: stuck, error } = await supabase
    .from("messages")
    .select("id, conversations!inner(channel)")
    .eq("status", "sending")
    .eq("conversations.channel", "whatsapp_cloud")
    .is("external_id", null)
    .lt("sent_at", cutoff)
    .limit(20);

  if (error || !stuck || stuck.length === 0) return;

  for (const row of stuck) {
    await supabase
      .from("messages")
      .update({
        status: "failed",
        error:
          "El envío quedó a medias (se reinició el worker en el medio). Si no llegó, reenvialo.",
        failed_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "sending");
    console.warn("→ WA-API rescatado de 'sending' colgado", row.id);
  }
}

// ─────────────────────────────────────────── Arranque

console.log("☁️ Worker de WhatsApp Cloud API arriba. Escuchando la cola de salida…");

// `void` en vez de await: si una vuelta falla, la siguiente sigue corriendo.
setInterval(() => void pollOutgoing(), POLL_INTERVAL_MS);
setInterval(() => void rescueStuckSending(), RESCUE_INTERVAL_MS);

// El chequeo de arranque avisa en logs si la cuenta no está lista, que es la
// pregunta número uno cuando "no sale nada".
void (async () => {
  const account: WhatsappCloudAccount | null = await loadAccount(supabase);
  if (!account) {
    console.warn(
      "⚠️ No hay fila en whatsapp_cloud_accounts. ¿Corriste scripts/sql/whatsapp-cloud-api.sql?",
    );
  } else if (!isSendable(account)) {
    console.warn(
      `⚠️ La cuenta no está lista para enviar (state=${account.state}). Conectala desde Configuración.`,
    );
  }
})();
