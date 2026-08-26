import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyInboundMessage } from "@/lib/push/send";
import type { Database } from "@/types/database.types";
import { processInboundAutomations } from "@/worker/automations";
import { processInboundReview } from "@/worker/reviews";
import { transcribeAndStore } from "@/worker/transcribe";
import { downloadMedia, fetchMediaInfo } from "./client";
import type { WhatsappCloudAccount } from "./config";
import {
  cloudTimestamp,
  type CloudEvent,
  type CloudInboundMessage,
  type CloudMessagesValue,
  type CloudStatus,
  type CloudTemplateStatusValue,
} from "./webhook";

const BUCKET = "wa-media";

type Db = SupabaseClient<Database>;

/** Código de violación de unique constraint en Postgres. */
const UNIQUE_VIOLATION = "23505";

// ─────────────────────────────────────────── Conversación

/**
 * Get-or-create por (channel='whatsapp_cloud', external_id=wa_id).
 *
 * El `wa_id` de la Cloud API son los dígitos del número en formato
 * internacional ("54911..."), sin arroba ni sufijo: acá el external_id ES el
 * teléfono. Ojo que es un canal distinto del `whatsapp` de Baileys a
 * propósito — el mismo contacto puede tener un chat por cada número del
 * salón, igual que le pasaría con dos teléfonos.
 */
async function getOrCreateConversation(
  supabase: Db,
  args: { waId: string; profileName?: string | null },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, display_name")
    .eq("channel", "whatsapp_cloud")
    .eq("external_id", args.waId)
    .maybeSingle();

  if (existing) {
    // El nombre de perfil viene en cada webhook; lo rellenamos una sola vez.
    const name = args.profileName?.trim();
    if (name && !existing.display_name) {
      await supabase
        .from("conversations")
        .update({ display_name: name })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  const last8 = args.waId.replace(/\D/g, "").slice(-8);

  // Segundo intento, por los últimos 8 dígitos. Es lo que hace que una
  // automatización pueda abrir el chat ANTES de que la clienta escriba: ese
  // chat se crea con los dígitos del teléfono de la ficha, y Meta devuelve los
  // números argentinos SIN el 9 del celular ("5493511234567" en la ficha,
  // "543511234567" en el `wa_id`). Sin este paso la respuesta caería en una
  // conversación nueva y la clienta quedaría partida en dos chats del mismo
  // número.
  if (last8.length === 8) {
    const { data: byPhone } = await supabase
      .from("conversations")
      .select("id, display_name, external_id")
      .eq("channel", "whatsapp_cloud")
      .or(`external_id.ilike.%${last8}%,wa_phone.ilike.%${last8}%`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (byPhone) {
      // Se adopta el `wa_id` de Meta como external_id: a partir de acá la
      // búsqueda exacta de arriba acierta y no se vuelve a pasar por este
      // camino. Si el UPDATE choca contra el único, es que otro evento en
      // paralelo ya creó la fila con ese id — no es grave, seguimos con ésta.
      const patch: Database["public"]["Tables"]["conversations"]["Update"] = {};
      if (byPhone.external_id !== args.waId) patch.external_id = args.waId;
      const name = args.profileName?.trim();
      if (name && !byPhone.display_name) patch.display_name = name;

      if (Object.keys(patch).length > 0) {
        const { error: adoptErr } = await supabase
          .from("conversations")
          .update(patch)
          .eq("id", byPhone.id);
        if (adoptErr && adoptErr.code !== UNIQUE_VIOLATION) {
          console.error("[wa-cloud] adopt conversation error:", adoptErr.message);
        }
      }
      return byPhone.id;
    }
  }

  // Mismo criterio de vinculación que usa el worker de Baileys al crear una
  // conversación: últimos 8 dígitos contra el teléfono de la ficha.
  let clientId: string | null = null;
  if (last8.length === 8) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .ilike("phone", `%${last8}%`)
      .limit(1)
      .maybeSingle();
    clientId = client?.id ?? null;
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      channel: "whatsapp_cloud",
      external_id: args.waId,
      display_name: args.profileName?.trim() || null,
      wa_phone: args.waId.replace(/\D/g, "") || null,
      client_id: clientId,
    })
    .select("id")
    .single();

  if (error) {
    // Dos eventos del mismo contacto en paralelo: el índice único
    // (channel, external_id) hace que uno pierda. Releemos el ganador.
    if (error.code === UNIQUE_VIOLATION) {
      const { data: raced } = await supabase
        .from("conversations")
        .select("id")
        .eq("channel", "whatsapp_cloud")
        .eq("external_id", args.waId)
        .maybeSingle();
      return raced?.id ?? null;
    }
    console.error("[wa-cloud] conversation insert error:", error.message);
    return null;
  }

  return created.id;
}

// ─────────────────────────────────────────── Media

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
};

/**
 * Descarga el adjunto desde Meta y lo guarda en nuestro Storage. Las URLs
 * de media de la Cloud API vencen a los 5 minutos, así que guardar la URL
 * pelada no es opción — el archivo tiene que quedar en el bucket.
 */
async function storeCloudMedia(
  supabase: Db,
  args: {
    account: WhatsappCloudAccount & { access_token: string };
    mediaId: string;
    conversationId: string;
    wamid: string;
    filename?: string | null;
  },
): Promise<{ path: string; mime: string } | null> {
  try {
    const info = await fetchMediaInfo({
      accessToken: args.account.access_token,
      mediaId: args.mediaId,
    });
    if (!info.url) return null;

    const media = await downloadMedia({
      accessToken: args.account.access_token,
      url: info.url,
    });
    if (!media) return null;

    const mime = info.mime_type?.split(";")[0]?.trim() || media.mime;
    // El filename viene del teléfono del remitente: solo se acepta como
    // extensión un sufijo alfanumérico corto, nunca texto arbitrario que
    // termine metido en la key de Storage.
    const rawExt = args.filename?.includes(".")
      ? args.filename.split(".").pop()
      : null;
    const extFromName =
      rawExt && /^[a-zA-Z0-9]{1,8}$/.test(rawExt) ? rawExt.toLowerCase() : null;
    const ext = extFromName || MIME_TO_EXT[mime] || "bin";

    // El wamid trae caracteres no aptos para una key de Storage.
    const safeWamid = args.wamid.replace(/[^a-zA-Z0-9._-]/g, "");
    const path = `media/${args.conversationId}/wa-${safeWamid}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, media.buffer, { contentType: mime, upsert: true });

    if (error) {
      console.error("[wa-cloud] storage upload error:", error.message);
      return null;
    }
    return { path, mime };
  } catch (err) {
    console.error(
      "[wa-cloud] media store failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─────────────────────────────────────────── Inserción de mensajes

/**
 * Inserta con dedup por (conversation_id, external_id) — Meta reintenta la
 * entrega del webhook y reenvía el mismo wamid. Devuelve el id insertado, o
 * null si era un duplicado o falló.
 */
async function insertMessage(
  supabase: Db,
  row: Database["public"]["Tables"]["messages"]["Insert"],
): Promise<string | null> {
  if (row.external_id) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", row.conversation_id)
      .eq("external_id", row.external_id)
      .maybeSingle();
    if (existing) return null;
  }

  const { data, error } = await supabase
    .from("messages")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    console.error("[wa-cloud] message insert error:", error.message);
    return null;
  }
  return data.id;
}

// ─────────────────────────────────────────── Mensajes entrantes

type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

function mediaOf(
  message: CloudInboundMessage,
): { kind: MediaKind; media: NonNullable<CloudInboundMessage["image"]> } | null {
  if (message.image) return { kind: "image", media: message.image };
  if (message.video) return { kind: "video", media: message.video };
  if (message.audio) return { kind: "audio", media: message.audio };
  if (message.document) return { kind: "document", media: message.document };
  if (message.sticker) return { kind: "sticker", media: message.sticker };
  return null;
}

/**
 * Texto plano para los tipos que no tienen fila propia en nuestro modelo:
 * ubicaciones, contactos compartidos y respuestas de botones. Es preferible
 * una burbuja de texto legible a descartar el mensaje.
 */
function textualBody(message: CloudInboundMessage): string | null {
  if (message.type === "text") return message.text?.body?.trim() || null;

  if (message.type === "location" && message.location) {
    const { latitude, longitude, name, address } = message.location;
    const label = [name, address].filter(Boolean).join(" · ");
    const maps =
      latitude !== undefined && longitude !== undefined
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : null;
    return ["📍 Ubicación", label || null, maps].filter(Boolean).join("\n");
  }

  if (message.type === "contacts" && message.contacts?.length) {
    const lines = message.contacts.map((c) => {
      const phone = c.phones?.[0]?.phone ?? c.phones?.[0]?.wa_id ?? "";
      return `👤 ${c.name?.formatted_name ?? "Contacto"}${phone ? ` — ${phone}` : ""}`;
    });
    return lines.join("\n");
  }

  if (message.type === "button") return message.button?.text?.trim() || null;

  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title?.trim() ||
      message.interactive?.list_reply?.title?.trim() ||
      null
    );
  }

  return null;
}

/**
 * Lo que se dispara cuando entra un mensaje real de una clienta: primero la
 * encuesta de reseña, después las automatizaciones de mensaje entrante.
 *
 * Vive acá y no en el worker de salida porque en la Cloud API los entrantes no
 * pasan por ningún worker: llegan por el webhook de Next. Es el equivalente
 * exacto del bloque que tenía el worker de Baileys, que dejó de correrlo
 * cuando el número viejo pasó a ser archivo.
 *
 * El orden no es casual: si este "5" era la respuesta a una encuesta abierta,
 * la reseña se lo queda y corta. Sin eso, el mismo mensaje dispararía además
 * el saludo de reactivación y la clienta recibiría dos respuestas encimadas.
 *
 * Se hace `await` a propósito, no fire-and-forget: esto corre dentro del
 * `after()` de la ruta, y una promesa suelta puede quedar cortada cuando el
 * handler termina — perdiendo la respuesta automática sin dejar rastro.
 */
async function runInboundHooks(
  supabase: Db,
  args: {
    conversationId: string;
    messageId: string;
    body: string | null;
    sentAt: Date;
  },
): Promise<void> {
  try {
    const consumed = await processInboundReview(
      supabase,
      args.conversationId,
      args.body,
      args.sentAt,
    );
    if (consumed) return;

    await processInboundAutomations(
      supabase,
      args.conversationId,
      args.messageId,
      args.sentAt,
    );
  } catch (err) {
    // Una automatización rota no puede impedir que el mensaje quede guardado:
    // para cuando llegamos acá la fila ya está en la bandeja.
    console.error(
      "[wa-cloud] fallo en los disparadores de entrada:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function handleInboundMessage(
  supabase: Db,
  message: CloudInboundMessage,
  value: CloudMessagesValue,
  account: WhatsappCloudAccount | null,
): Promise<void> {
  const waId = message.from;
  if (!waId || !message.id) return;

  const profileName = value.contacts?.find((c) => c.wa_id === waId)?.profile
    ?.name;

  const conversationId = await getOrCreateConversation(supabase, {
    waId,
    profileName,
  });
  if (!conversationId) return;

  const sentAt = cloudTimestamp(message.timestamp);

  // Reacciones: fila propia apuntando al wamid del mensaje reaccionado.
  if (message.type === "reaction" && message.reaction?.message_id) {
    await insertMessage(supabase, {
      conversation_id: conversationId,
      external_id: message.id,
      direction: "inbound",
      type: "reaction",
      // Sin emoji = sacó la reacción. Body vacío es la convención del CRM.
      body: message.reaction.emoji ?? "",
      reaction_target_external_id: message.reaction.message_id,
      status: "delivered",
      sent_at: sentAt,
    });
    return;
  }

  const media = message.type ? mediaOf(message) : null;

  if (media) {
    const stored = account?.access_token
      ? media.media.id
        ? await storeCloudMedia(supabase, {
            account: account as WhatsappCloudAccount & { access_token: string },
            mediaId: media.media.id,
            conversationId,
            wamid: message.id,
            filename: media.media.filename,
          })
        : null
      : null;

    // Si no pudimos bajar el archivo igual dejamos rastro del mensaje: es
    // preferible una fila que diga "mandó una imagen" a un hueco silencioso.
    const insertedId = await insertMessage(supabase, {
      conversation_id: conversationId,
      external_id: message.id,
      direction: "inbound",
      type: media.kind,
      body: media.media.caption?.trim() || null,
      media_url: stored?.path ?? null,
      media_mime: stored?.mime ?? media.media.mime_type ?? null,
      media_filename: media.media.filename ?? null,
      reply_to_external_id: message.context?.id ?? null,
      status: "delivered",
      sent_at: sentAt,
      error: stored ? null : "No pudimos descargar el adjunto de WhatsApp.",
    });

    if (insertedId) {
      // Las notas de voz se transcriben igual que en el canal de Baileys.
      if (media.kind === "audio" && stored) {
        void transcribeAndStore(supabase, insertedId, stored.path, stored.mime);
      }
      void notifyInboundMessage(supabase, {
        conversationId,
        body: media.media.caption ?? null,
        type: media.kind,
      });
      await runInboundHooks(supabase, {
        conversationId,
        messageId: insertedId,
        body: media.media.caption?.trim() || null,
        sentAt: new Date(sentAt),
      });
    }
    return;
  }

  const body = textualBody(message);
  if (!body) {
    // `unsupported`, `order`, `system`… no aportan una burbuja útil.
    console.log(`[wa-cloud] mensaje ${message.type ?? "?"} ignorado`);
    return;
  }

  const insertedId = await insertMessage(supabase, {
    conversation_id: conversationId,
    external_id: message.id,
    direction: "inbound",
    type: "text",
    body,
    reply_to_external_id: message.context?.id ?? null,
    status: "delivered",
    sent_at: sentAt,
  });

  if (insertedId) {
    void notifyInboundMessage(supabase, {
      conversationId,
      body,
      type: "text",
    });
    await runInboundHooks(supabase, {
      conversationId,
      messageId: insertedId,
      body,
      sentAt: new Date(sentAt),
    });
  }
}

// ─────────────────────────────────────────── Acuses de estado

type MessageStatus = Database["public"]["Enums"]["message_status"];

/**
 * Aplica el patch de un acuse sobre el mensaje con ese wamid, con reintentos.
 *
 * El worker recién guarda el `external_id` DESPUÉS de que Meta le responde el
 * envío, y Meta puede emitir el acuse `sent`/`delivered` en ese mismo segundo:
 * si el acuse gana la carrera, el UPDATE matchea cero filas y Meta no
 * reintenta (ya le contestamos 200). Un par de esperas cortas absorben la
 * carrera. Cero filas con el mensaje existente no se reintenta: significa que
 * el estado ya avanzó más allá de `allowedStatuses` (un `delivered` tardío no
 * debe pisar un `read`).
 */
async function updateOutboundByWamid(
  supabase: Db,
  wamid: string,
  patch: Database["public"]["Tables"]["messages"]["Update"],
  allowedStatuses: MessageStatus[] | null,
): Promise<void> {
  const DELAYS_MS = [0, 1_500, 4_000];

  for (const delay of DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    let query = supabase
      .from("messages")
      .update(patch)
      .eq("external_id", wamid)
      .eq("direction", "outbound");
    if (allowedStatuses) query = query.in("status", allowedStatuses);

    const { data, error } = await query.select("id");
    if (error) {
      console.error("[wa-cloud] status update error:", error.message);
      return;
    }
    if (data && data.length > 0) return;

    // 0 filas: ¿no existe todavía (worker a mitad de camino) o ya está en un
    // estado más avanzado? Solo el primer caso amerita reintentar.
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", wamid)
      .eq("direction", "outbound")
      .maybeSingle();
    if (existing) return;
  }

  console.warn(`[wa-cloud] acuse sin mensaje que actualizar: ${wamid}`);
}

/**
 * `statuses` trae el ciclo de vida de NUESTROS mensajes: sent → delivered →
 * read, o failed con el motivo. Se ubican por `external_id` (el wamid que
 * devolvió el envío). Los acuses pueden llegar desordenados, así que nunca
 * se degrada un estado: un `delivered` tardío no pisa un `read`.
 */
async function handleStatus(supabase: Db, status: CloudStatus): Promise<void> {
  if (!status.id || !status.status) return;
  const at = cloudTimestamp(status.timestamp);

  if (status.status === "failed") {
    const first = status.errors?.[0];
    const reason =
      [first?.title ?? first?.message, first?.error_data?.details]
        .filter(Boolean)
        .join(" — ") || "Meta rechazó el mensaje.";
    const friendly =
      first?.code === 131047
        ? "Fuera de la ventana de 24 h: mandá una plantilla para reabrir la conversación."
        : reason;

    await updateOutboundByWamid(
      supabase,
      status.id,
      { status: "failed", error: friendly.slice(0, 500), failed_at: at },
      null,
    );
    return;
  }

  if (status.status === "delivered") {
    await updateOutboundByWamid(
      supabase,
      status.id,
      { status: "delivered", delivered_at: at },
      ["queued", "sending", "sent"],
    );
    return;
  }

  if (status.status === "read") {
    await updateOutboundByWamid(
      supabase,
      status.id,
      { status: "read", read_at: at },
      ["queued", "sending", "sent", "delivered"],
    );
    return;
  }

  // "sent": el worker ya deja la fila en 'sent' al enviar; esto cubre la
  // carrera en la que el acuse le gana a ese guardado.
  if (status.status === "sent") {
    await updateOutboundByWamid(supabase, status.id, { status: "sent" }, [
      "queued",
      "sending",
    ]);
  }
}

// ─────────────────────────────────────────── Estado de plantillas

/**
 * El WhatsApp Manager avisa cuando una plantilla se aprueba/rechaza/pausa.
 * Actualizamos el caché para que el selector del chat no ofrezca una
 * plantilla que Meta ya no acepta.
 */
async function handleTemplateStatus(
  supabase: Db,
  value: CloudTemplateStatusValue,
): Promise<void> {
  const name = value.message_template_name;
  const language = value.message_template_language;
  const event = value.event?.toUpperCase();
  if (!name || !language || !event) return;

  const { error } = await supabase
    .from("whatsapp_templates")
    .update({ status: event, synced_at: new Date().toISOString() })
    .eq("name", name)
    .eq("language", language);

  if (error) {
    console.error("[wa-cloud] template status update error:", error.message);
  } else if (value.reason) {
    console.log(
      `[wa-cloud] plantilla ${name}/${language} → ${event} (${value.reason})`,
    );
  }
}

// ─────────────────────────────────────────── Punto de entrada

/**
 * Procesa los eventos de un webhook en serie a propósito: varios mensajes del
 * mismo contacto pueden llegar juntos y el get-or-create en paralelo
 * generaría carreras innecesarias.
 */
export async function ingestCloudEvents(
  supabase: Db,
  events: CloudEvent[],
  account: WhatsappCloudAccount | null,
): Promise<void> {
  for (const event of events) {
    try {
      if (event.kind === "template_status") {
        await handleTemplateStatus(supabase, event.value);
        continue;
      }

      // La suscripción de webhooks es por app de Meta: si la app tiene más de
      // un número (el de prueba del dashboard, un segundo número del WABA),
      // llegan eventos de todos. Solo procesamos los del número conectado —
      // mezclar chats de dos números en un solo canal sería incorregible.
      const eventPhoneId = event.value.metadata?.phone_number_id;
      if (
        eventPhoneId &&
        account?.phone_number_id &&
        eventPhoneId !== account.phone_number_id
      ) {
        console.log(
          `[wa-cloud] evento de otro número (${eventPhoneId}) ignorado`,
        );
        continue;
      }

      for (const message of event.value.messages ?? []) {
        await handleInboundMessage(supabase, message, event.value, account);
      }
      for (const status of event.value.statuses ?? []) {
        await handleStatus(supabase, status);
      }
    } catch (err) {
      // Un evento roto no puede tumbar el resto del lote.
      console.error(
        "[wa-cloud] error procesando evento:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
