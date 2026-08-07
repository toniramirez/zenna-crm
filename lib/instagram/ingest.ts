import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fetchContactProfile } from "./client";
import { isSendable, type InstagramAccount } from "./config";
import {
  attachmentToMessageType,
  eventTimestamp,
  type IgAttachment,
  type IgMessaging,
} from "./webhook";

const BUCKET = "wa-media";

type Db = SupabaseClient<Database>;
type MessageType = Database["public"]["Enums"]["message_type"];

/** Código de violación de unique constraint en Postgres. */
const UNIQUE_VIOLATION = "23505";

// ─────────────────────────────────────────── Conversación

/**
 * Get-or-create de la conversación por (channel='instagram', external_id=IGSID).
 *
 * El IGSID es un id *por app*: la misma persona tiene un IGSID distinto en otra
 * integración. Sirve como identidad estable dentro de nuestra cuenta, que es lo
 * único que necesitamos, pero por eso no se puede cruzar con nada externo.
 *
 * A diferencia de WhatsApp no hay teléfono, así que la conversación arranca sin
 * `client_id`: la recepcionista la vincula a una clienta desde el chat (o al
 * etiquetarla se crea una). No inventamos un match por nombre — dos "Sofía"
 * distintas terminarían pisándose la ficha.
 */
async function getOrCreateConversation(
  supabase: Db,
  args: {
    igsid: string;
    account: InstagramAccount | null;
    displayName?: string | null;
  },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, display_name, avatar_path")
    .eq("channel", "instagram")
    .eq("external_id", args.igsid)
    .maybeSingle();

  if (existing) {
    // Rellenamos nombre/foto una sola vez; después no volvemos a molestar a la
    // API de Meta en cada mensaje.
    if (!existing.display_name || !existing.avatar_path) {
      void hydrateProfile(supabase, {
        conversationId: existing.id,
        igsid: args.igsid,
        account: args.account,
        hasName: Boolean(existing.display_name),
        hasAvatar: Boolean(existing.avatar_path),
      });
    }
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      channel: "instagram",
      external_id: args.igsid,
      display_name: args.displayName ?? null,
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
        .eq("channel", "instagram")
        .eq("external_id", args.igsid)
        .maybeSingle();
      return raced?.id ?? null;
    }
    console.error("[instagram] conversation insert error:", error.message);
    return null;
  }

  void hydrateProfile(supabase, {
    conversationId: created.id,
    igsid: args.igsid,
    account: args.account,
    hasName: Boolean(args.displayName),
    hasAvatar: false,
  });

  return created.id;
}

/**
 * Trae nombre + foto de perfil desde Meta y los cachea. Best-effort y en
 * background: si falla, la conversación igual funciona con el IGSID.
 */
async function hydrateProfile(
  supabase: Db,
  args: {
    conversationId: string;
    igsid: string;
    account: InstagramAccount | null;
    hasName: boolean;
    hasAvatar: boolean;
  },
): Promise<void> {
  if (!isSendable(args.account)) return;

  const profile = await fetchContactProfile({
    account: args.account,
    igsid: args.igsid,
  });
  if (!profile) return;

  const patch: Database["public"]["Tables"]["conversations"]["Update"] = {};

  const name = profile.name?.trim() || profile.username?.trim();
  if (name && !args.hasName) patch.display_name = name;

  const picUrl = (profile as { profile_pic?: string }).profile_pic;
  if (picUrl && !args.hasAvatar) {
    const path = await storeRemoteFile(supabase, {
      url: picUrl,
      path: `avatars/ig-${args.igsid}.jpg`,
      fallbackMime: "image/jpeg",
    });
    if (path) patch.avatar_path = path.path;
  }

  if (Object.keys(patch).length === 0) return;

  await supabase
    .from("conversations")
    .update(patch)
    .eq("id", args.conversationId);
}

// ─────────────────────────────────────────── Media

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
};

/**
 * Descarga un archivo de la CDN de Meta y lo guarda en nuestro Storage.
 *
 * Las URLs que manda Meta son firmadas y caducan en horas, así que guardar la
 * URL pelada dejaría la bandeja llena de adjuntos rotos a los pocos días.
 */
async function storeRemoteFile(
  supabase: Db,
  args: { url: string; path: string; fallbackMime?: string },
): Promise<{ path: string; mime: string } | null> {
  try {
    const res = await fetch(args.url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[instagram] media fetch ${res.status} para ${args.path}`);
      return null;
    }

    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      args.fallbackMime ||
      "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(args.path, buffer, { contentType: mime, upsert: true });

    if (error) {
      console.error("[instagram] storage upload error:", error.message);
      return null;
    }
    return { path: args.path, mime };
  } catch (err) {
    console.error(
      "[instagram] media download failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function storeAttachment(
  supabase: Db,
  args: {
    attachment: IgAttachment;
    conversationId: string;
    mid: string;
    index: number;
  },
): Promise<{ path: string; mime: string } | null> {
  const url = args.attachment.payload?.url;
  if (!url) return null;

  const type = attachmentToMessageType(args.attachment.type);
  const fallbackMime =
    type === "video"
      ? "video/mp4"
      : type === "audio"
        ? "audio/mp4"
        : type === "image"
          ? "image/jpeg"
          : "application/octet-stream";
  const ext = MIME_TO_EXT[fallbackMime] ?? "bin";

  // El mid puede traer caracteres no aptos para una key de Storage.
  const safeMid = args.mid.replace(/[^a-zA-Z0-9._-]/g, "");
  return storeRemoteFile(supabase, {
    url,
    path: `media/${args.conversationId}/ig-${safeMid}-${args.index}.${ext}`,
    fallbackMime,
  });
}

// ─────────────────────────────────────────── Inserción de mensajes

async function insertMessage(
  supabase: Db,
  row: Database["public"]["Tables"]["messages"]["Insert"],
): Promise<boolean> {
  // Meta reintenta el webhook si tardamos en responder 200, y reenvía el mismo
  // `mid`. Dos defensas contra eso, en este orden:
  //
  //   1. Este chequeo, que es el que hace el trabajo. No depende de que el
  //      índice único exista — en bases con histórico de WhatsApp puede no
  //      haberse podido crear.
  //   2. El 23505 de más abajo, para la carrera en la que dos entregas del
  //      mismo evento pasan el chequeo a la vez.
  if (row.external_id) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", row.conversation_id)
      .eq("external_id", row.external_id)
      .maybeSingle();
    if (existing) return false;
  }

  const { error } = await supabase.from("messages").insert(row);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false;
    console.error("[instagram] message insert error:", error.message);
    return false;
  }
  return true;
}

/**
 * Procesa un evento de mensaje (`messaging[].message`).
 *
 * `is_echo` marca los mensajes enviados por la propia cuenta desde *otro* lado
 * (la app de Instagram, otra herramienta). Los guardamos como salientes para
 * que la bandeja refleje la conversación completa. Los que mandamos nosotros ya
 * quedaron guardados con su `mid` al enviarlos, así que el dedup por
 * external_id los descarta acá.
 */
async function handleMessageEvent(
  supabase: Db,
  event: IgMessaging,
  account: InstagramAccount | null,
): Promise<void> {
  const message = event.message;
  if (!message?.mid) return;
  // Borrados y no soportados no aportan nada a la bandeja.
  if (message.is_deleted) return;

  const isEcho = Boolean(message.is_echo);
  // En un echo el "otro" es el destinatario; en un entrante, el emisor.
  const igsid = isEcho ? event.recipient?.id : event.sender?.id;
  if (!igsid) return;

  const conversationId = await getOrCreateConversation(supabase, {
    igsid,
    account,
  });
  if (!conversationId) return;

  const sentAt = eventTimestamp(event.timestamp);

  const text = message.text?.trim() || null;
  const attachments = message.attachments ?? [];
  const replyTo = message.reply_to?.mid ?? null;

  const base = {
    conversation_id: conversationId,
    direction: (isEcho ? "outbound" : "inbound") as "inbound" | "outbound",
    status: (isEcho ? "sent" : "delivered") as "sent" | "delivered",
    sent_at: sentAt,
    reply_to_external_id: replyTo,
  };

  if (attachments.length === 0) {
    if (!text) return;
    await insertMessage(supabase, {
      ...base,
      external_id: message.mid,
      type: "text",
      body: text,
    });
    return;
  }

  // Un mensaje de Instagram puede traer varios adjuntos, pero nuestro modelo es
  // una fila por pieza. Se numera el external_id a partir del segundo para no
  // chocar con el índice único, dejando el primero con el `mid` limpio (que es
  // el que Meta referencia en reacciones y respuestas).
  for (const [index, attachment] of attachments.entries()) {
    const type = attachmentToMessageType(attachment.type);
    const stored = await storeAttachment(supabase, {
      attachment,
      conversationId,
      mid: message.mid,
      index,
    });

    // Si no pudimos bajar el archivo igual dejamos rastro del mensaje: es
    // preferible una fila que diga "mandó una imagen" a un hueco silencioso.
    await insertMessage(supabase, {
      ...base,
      external_id: index === 0 ? message.mid : `${message.mid}:${index}`,
      type: (type ?? "document") as MessageType,
      body: index === 0 ? text : null,
      media_url: stored?.path ?? null,
      media_mime: stored?.mime ?? null,
      media_filename: attachment.payload?.title ?? null,
      error: stored ? null : "No pudimos descargar el adjunto de Instagram.",
    });
  }
}

/** Reacciones (❤️ y compañía) sobre un mensaje concreto. */
async function handleReactionEvent(
  supabase: Db,
  event: IgMessaging,
  account: InstagramAccount | null,
): Promise<void> {
  const reaction = event.reaction;
  const igsid = event.sender?.id;
  if (!reaction?.mid || !igsid) return;

  const conversationId = await getOrCreateConversation(supabase, {
    igsid,
    account,
  });
  if (!conversationId) return;

  await insertMessage(supabase, {
    conversation_id: conversationId,
    direction: "inbound",
    type: "reaction",
    // `unreact` = sacó la reacción. Body vacío es la convención que ya usa el
    // worker de WhatsApp para lo mismo.
    body: reaction.action === "unreact" ? "" : (reaction.emoji ?? "❤️"),
    reaction_target_external_id: reaction.mid,
    status: "delivered",
    sent_at: eventTimestamp(event.timestamp),
  });
}

/** Acuse de lectura: marca como leídos nuestros salientes de esa conversación. */
async function handleReadEvent(supabase: Db, event: IgMessaging): Promise<void> {
  const igsid = event.sender?.id;
  if (!igsid || !event.read) return;

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("channel", "instagram")
    .eq("external_id", igsid)
    .maybeSingle();
  if (!conversation) return;

  const readAt = eventTimestamp(event.timestamp);

  await supabase
    .from("messages")
    .update({ status: "read", read_at: readAt })
    .eq("conversation_id", conversation.id)
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"]);
}

/**
 * Punto de entrada del webhook. Procesa los eventos en serie a propósito:
 * varios mensajes del mismo contacto pueden llegar juntos y el get-or-create
 * en paralelo generaría carreras innecesarias.
 */
export async function ingestMessagingEvents(
  supabase: Db,
  events: IgMessaging[],
  account: InstagramAccount | null,
): Promise<void> {
  for (const event of events) {
    try {
      if (event.message) {
        await handleMessageEvent(supabase, event, account);
      } else if (event.reaction) {
        await handleReactionEvent(supabase, event, account);
      } else if (event.read) {
        await handleReadEvent(supabase, event);
      }
      // `postback` y `quick_reply` llegan acá si en el futuro se usan botones.
    } catch (err) {
      // Un evento roto no puede tumbar el resto del lote.
      console.error(
        "[instagram] error procesando evento:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
