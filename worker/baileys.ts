import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import { Boom } from "@hapi/boom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  proto,
  WAMessageStubType,
  type WAMessage,
  type WAMessageContent,
  type WAMessageKey,
  type WASocket,
} from "@whiskeysockets/baileys";

/**
 * Serialize a Baileys `proto.IMessage` to a base64 string. We use the
 * official protobuf encoder rather than JSON.stringify so Uint8Array
 * fields (mediaKey, fileEncSha256, etc.) round-trip cleanly — those
 * fields are what `getMessage` needs to re-encrypt a retry.
 */
function encodeWaMessageContent(content: WAMessageContent): string {
  const encoded = proto.Message.encode(content).finish();
  return Buffer.from(encoded).toString("base64");
}

function decodeWaMessageContent(b64: string): WAMessageContent {
  const buf = Buffer.from(b64, "base64");
  return proto.Message.decode(buf);
}
import qrcode from "qrcode-terminal";
import { notifyInboundMessage } from "@/lib/push/send";
import type { Database } from "@/types/database.types";
import { processAutomations, processInboundAutomations } from "./automations";
import { downloadAndStoreMedia, fetchAndStoreAvatar } from "./media";
import { useSupabaseAuthState } from "./supabase-auth";
import { transcribeAndStore } from "./transcribe";

const SESSION_ID = process.env.WA_SESSION_ID || "default";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL no está configurada.");
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ SUPABASE_SERVICE_ROLE_KEY falta. Sacala del dashboard de Supabase y agregala a .env.local.",
  );
  process.exit(1);
}

const supabase: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let currentSock: WASocket | null = null;
let loggingOut = false;
let connecting = false;

// ─────────────────────────────────────────── Status sync

type StatusPatch = Partial<{
  state:
    | "disconnected"
    | "connecting"
    | "qr"
    | "connected"
    | "logout_requested"
    | "reconnect_requested";
  qr: string | null;
  phone_number: string | null;
  last_connected_at: string;
  last_error: string | null;
  updated_at: string;
}>;

/**
 * Is the socket actually usable right now? `currentSock?.user` only tells us
 * that a socket object was built and paired at some point — the underlying
 * WebSocket can already be closed while the object lingers. That gap is what
 * made outgoing sends fail with "Connection Closed" instead of waiting for
 * the reconnect.
 */
function isSocketAlive(): boolean {
  return !!currentSock?.user && currentSock.ws?.isOpen === true;
}

async function updateStatus(patch: StatusPatch) {
  const { error } = await supabase
    .from("whatsapp_status")
    .upsert(
      { session_id: SESSION_ID, ...patch },
      { onConflict: "session_id" },
    );
  if (error) console.error("[status] upsert error:", error);
}

async function clearStoredCreds() {
  await supabase
    .from("whatsapp_sessions")
    .delete()
    .eq("session_id", SESSION_ID);
}

async function checkCommands() {
  const { data } = await supabase
    .from("whatsapp_status")
    .select("state")
    .eq("session_id", SESSION_ID)
    .maybeSingle();
  if (!data) return;

  if (data.state === "logout_requested" && !loggingOut) {
    loggingOut = true;
    console.log("⚠️  Logout solicitado desde la UI. Desvinculando...");
    try {
      if (currentSock?.user) {
        await currentSock.logout();
      }
    } catch (err) {
      console.error("[logout] error:", err);
    }
    await clearStoredCreds();
    currentSock = null;
    await updateStatus({
      state: "disconnected",
      qr: null,
      phone_number: null,
      last_error: null,
    });
    loggingOut = false;
    return;
  }

  if (data.state === "reconnect_requested") {
    if (connecting) return;

    // El socket ya está sano: la orden llegó porque la UI lo veía caído (un
    // latido viejo, por ejemplo). Antes este caso se ignoraba en silencio y
    // como el heartbeat sólo toca `updated_at`, la fila quedaba en
    // 'reconnect_requested' para siempre: spinner de "Reconectando…" eterno
    // sobre una sesión que en realidad andaba. Resincronizamos y listo.
    if (isSocketAlive()) {
      console.log("🔄 Reconexión pedida, pero el socket está vivo. Resincronizando estado.");
      await updateStatus({
        state: "connected",
        qr: null,
        phone_number: currentSock?.user?.id ?? null,
        last_error: null,
      });
      return;
    }

    console.log("🔄 Reconexión solicitada desde la UI. Redialando...");
    // Puede quedar un socket zombi: el objeto sigue ahí con `user` cargado
    // pero el WebSocket ya está cerrado. Antes el guard era `!currentSock`, así
    // que en ese estado la orden se ignoraba para siempre y el botón no hacía
    // nada. Lo cerramos antes de abrir otro — dos sockets sobre las mismas
    // creds se pisan entre sí.
    if (currentSock) {
      try {
        currentSock.end(undefined);
      } catch {
        // ya estaba muerto
      }
      currentSock = null;
    }
    // NO borramos las creds acá. Si siguen siendo válidas queremos reconectar
    // sin obligar a rescanear el QR; y si WhatsApp las rechaza, el handler de
    // `connection === "close"` ya detecta loggedOut, las limpia y muestra un
    // QR nuevo solo.
    await updateStatus({ state: "connecting", last_error: null, qr: null });
    void connect();
  }
}

setInterval(() => void checkCommands(), 3000);

/**
 * Latido. `whatsapp_status` sólo se escribía en los cambios de conexión, así
 * que si el worker se moría (o se quedaba con un socket muerto) la fila
 * quedaba en 'connected' para siempre y la UI mostraba "Conectado" con todo
 * caído. Refrescamos `updated_at` mientras el socket esté realmente abierto;
 * la UI trata un 'connected' viejo como sin conexión.
 *
 * Sólo tocamos `updated_at`: no pisamos `state` para no atropellar un
 * logout_requested / reconnect_requested que la UI acabe de escribir.
 */
const HEARTBEAT_MS = 30_000;

async function heartbeat() {
  if (!isSocketAlive()) return;
  await updateStatus({ updated_at: new Date().toISOString() });
}

setInterval(() => void heartbeat(), HEARTBEAT_MS);

// ─────────────────────────────────────────── Helpers (CRM ingest)

function jidPhoneDigits(jid: string): string {
  return jid.split("@")[0]?.replace(/\D/g, "") ?? "";
}

/**
 * Recover the contact's real phone digits when the message originated from a
 * @lid JID (WhatsApp's privacy-preserving ID). For legacy `@s.whatsapp.net`
 * JIDs the digits are already in the JID itself.
 */
function resolvePhoneDigits(
  externalId: string,
  senderPn: string | null | undefined,
): string | null {
  if (externalId.endsWith("@lid")) {
    const d = senderPn ? jidPhoneDigits(senderPn) : "";
    return d.length >= 8 ? d : null;
  }
  const d = jidPhoneDigits(externalId);
  return d.length >= 8 ? d : null;
}

async function getOrCreateConversation(
  externalId: string,
  displayName?: string | null,
  senderPn?: string | null,
): Promise<string | null> {
  const phoneDigits = resolvePhoneDigits(externalId, senderPn);

  const { data: existing } = await supabase
    .from("conversations")
    .select("id, avatar_path, display_name, wa_phone")
    .eq("channel", "whatsapp")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing) {
    const patch: Database["public"]["Tables"]["conversations"]["Update"] = {};
    // Refresh display_name if WhatsApp gave us one and the conversation
    // doesn't have it stored yet (or it changed). Empty pushName never
    // overwrites a non-empty stored name.
    const trimmed = displayName?.trim();
    if (trimmed && trimmed !== existing.display_name) {
      patch.display_name = trimmed;
    }
    // Backfill wa_phone the first time WhatsApp shares senderPn for a LID.
    if (phoneDigits && phoneDigits !== existing.wa_phone) {
      patch.wa_phone = phoneDigits;
    }
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("conversations")
        .update(patch)
        .eq("id", existing.id);
    }
    // Lazy backfill: if we don't have an avatar yet, fire one fetch in the
    // background. Skipped if we already have one cached.
    if (!existing.avatar_path && currentSock) {
      void fetchAndStoreAvatar(
        supabase,
        currentSock,
        externalId,
        existing.id,
        phoneDigits,
      );
    }
    return existing.id;
  }

  let clientId: string | null = null;
  if (phoneDigits) {
    const last8 = phoneDigits.slice(-8);
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
      channel: "whatsapp",
      external_id: externalId,
      display_name: displayName ?? null,
      client_id: clientId,
      wa_phone: phoneDigits,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[conversations] insert error:", error);
    return null;
  }

  // Fetch the avatar in the background (no await) — most users keep their
  // picture private so we don't want to block on this.
  if (currentSock) {
    void fetchAndStoreAvatar(
      supabase,
      currentSock,
      externalId,
      created.id,
      phoneDigits,
    );
  }

  return created.id;
}

function extractMessageBody(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}

/**
 * Persist an inbound reaction as a `messages` row with type='reaction'.
 * `body=''` means the remote removed their previous reaction.
 */
async function storeInboundReaction(args: {
  remoteJid: string | null;
  targetExternalId: string | null;
  targetFromMe: boolean;
  emoji: string;
  timestampMs?: number;
}) {
  if (!args.remoteJid || !args.targetExternalId) return;
  if (args.remoteJid.endsWith("@broadcast")) return;
  if (args.remoteJid.endsWith("@g.us")) return;
  if (args.remoteJid.endsWith("@newsletter")) return;

  const conversationId = await getOrCreateConversation(args.remoteJid);
  if (!conversationId) return;

  const sentAt = args.timestampMs
    ? new Date(args.timestampMs).toISOString()
    : new Date().toISOString();

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    type: "reaction",
    body: args.emoji ?? "",
    reaction_target_external_id: args.targetExternalId,
    status: "delivered",
    sent_at: sentAt,
  });
  if (error) console.error("[reaction] insert error:", error.message);
}

async function handleIncomingReaction(msg: WAMessage) {
  const reaction = msg.message?.reactionMessage;
  if (!reaction) return;
  await storeInboundReaction({
    remoteJid: msg.key.remoteJid ?? null,
    targetExternalId: reaction.key?.id ?? null,
    targetFromMe: !!reaction.key?.fromMe,
    emoji: reaction.text ?? "",
    timestampMs: reaction.senderTimestampMs
      ? Number(reaction.senderTimestampMs)
      : undefined,
  });
}

async function handleUpsertedMessage(msg: WAMessage) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;
  // Filter chats that are not 1-1 conversations with a real contact. WhatsApp
  // emits @broadcast (status + business broadcast lists), @g.us (groups) and
  // @newsletter (channels) here too — none of those belong in the CRM inbox.
  if (remoteJid.endsWith("@broadcast")) return;
  if (remoteJid.endsWith("@g.us")) return;
  if (remoteJid.endsWith("@newsletter")) return;

  const fromMe = !!msg.key.fromMe;
  const externalId = msg.key.id ?? null;

  // Dedupe por external_id, en ambas direcciones:
  //  - salientes: pollOutgoing guarda el key.id que devuelve Baileys y
  //    WhatsApp nos reenvía el mismo mensaje con fromMe=true (eco multi-device).
  //  - entrantes: al aceptar 'append', WhatsApp puede reentregar el mismo
  //    mensaje encolado en varias reconexiones. Sin este chequeo cada
  //    reconexión duplicaría la conversación entera.
  if (externalId) {
    // `.limit(1)` porque maybeSingle() devuelve error si ya hay más de una
    // fila con ese external_id (duplicados históricos): sin el limit ese error
    // se traduciría en data=null y volveríamos a insertar el mismo mensaje.
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", externalId)
      .limit(1)
      .maybeSingle();
    if (existing) return;
  }

  const conversationId = await getOrCreateConversation(
    remoteJid,
    fromMe ? null : (msg.pushName ?? null),
    msg.key.senderPn ?? null,
  );
  if (!conversationId) return;

  const sentAt = msg.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();

  const textBody = extractMessageBody(msg);

  let mediaResult: Awaited<ReturnType<typeof downloadAndStoreMedia>> = null;
  if (currentSock) {
    mediaResult = await downloadAndStoreMedia(
      supabase,
      currentSock,
      msg,
      conversationId,
    );
  }

  if (!textBody && !mediaResult) return;

  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  const replyToExternalId = ctxInfo?.stanzaId ?? null;

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      external_id: externalId,
      direction: fromMe ? "outbound" : "inbound",
      type: mediaResult?.type ?? "text",
      body: mediaResult?.caption ?? textBody ?? null,
      media_url: mediaResult?.path ?? null,
      media_mime: mediaResult?.mime ?? null,
      media_filename: mediaResult?.filename ?? null,
      reply_to_external_id: replyToExternalId,
      status: fromMe ? "sent" : "delivered",
      sent_at: sentAt,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[messages] insert error:", error);
    return;
  }

  // Fire-and-forget transcription for INBOUND voice notes / audio. We don't
  // transcribe outbound audios — those were recorded by the operator so they
  // already know what they said.
  if (
    !fromMe &&
    inserted?.id &&
    mediaResult?.type === "audio" &&
    mediaResult.path &&
    mediaResult.mime
  ) {
    void transcribeAndStore(
      supabase,
      inserted.id,
      mediaResult.path,
      mediaResult.mime,
    );
  }

  // Inbound automation hook (welcome / re-engagement). Reactions and
  // outbound echoes don't qualify — automations should react to real
  // incoming text/media only.
  if (!fromMe && inserted?.id) {
    void processInboundAutomations(
      supabase,
      conversationId,
      inserted.id,
      new Date(sentAt),
    );

    // Aviso al teléfono. Va suelto a propósito: si el push falla, el mensaje
    // ya quedó guardado y la bandeja lo muestra igual.
    void notifyInboundMessage(supabase, {
      conversationId,
      body: mediaResult?.caption ?? textBody ?? null,
      type: mediaResult?.type ?? "text",
    });
  }
}

/**
 * Conversación existente de un JID, sin crearla. Se usa para acotar los
 * cambios sobre un mensaje al chat correcto: el id de WhatsApp es único
 * dentro de un chat, no globalmente, y el histórico ya tiene repetidos.
 */
async function findConversationId(remoteJid: string): Promise<string | null> {
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("external_id", remoteJid)
    .maybeSingle();
  return data?.id ?? null;
}

/** "Se eliminó este mensaje" que llega del otro lado. */
async function applyRemoteRevoke(
  remoteJid: string | null,
  externalId: string,
): Promise<void> {
  if (!remoteJid) return;
  const conversationId = await findConversationId(remoteJid);
  if (!conversationId) return;

  await supabase
    .from("messages")
    .update({ revoked_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("external_id", externalId)
    .is("revoked_at", null);
}

/** Edición que llega del otro lado: cambia el texto y deja el sello. */
async function applyRemoteEdit(
  remoteJid: string | null,
  externalId: string,
  edited: WAMessageContent,
): Promise<void> {
  if (!remoteJid) return;
  const text =
    edited.conversation ?? edited.extendedTextMessage?.text ?? null;
  if (!text) return;

  const conversationId = await findConversationId(remoteJid);
  if (!conversationId) return;

  await supabase
    .from("messages")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("external_id", externalId);
}

// ─────────────────────────────────────────── Outgoing queue poller

type QueuedMessage = {
  id: string;
  conversation_id: string;
  type: Database["public"]["Enums"]["message_type"];
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  reaction_target_external_id: string | null;
  forwarded: boolean;
  conversations: { external_id: string; channel: string } | null;
};

async function downloadStorageBuffer(path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage
    .from("wa-media")
    .download(path);
  if (error || !data) {
    console.error("[poller] storage download error:", error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function sendOutgoing(
  m: QueuedMessage,
  jid: string,
): Promise<{ id?: string | null; content?: WAMessageContent | null }> {
  if (!currentSock) throw new Error("no_sock");

  // Reactions: look up the target key (need fromMe to be correct)
  if (m.type === "reaction") {
    if (!m.reaction_target_external_id) {
      throw new Error("reaction without target");
    }
    const { data: target } = await supabase
      .from("messages")
      .select("external_id, direction")
      .eq("external_id", m.reaction_target_external_id)
      .maybeSingle();
    if (!target?.external_id) throw new Error("target message not found");
    const result = await currentSock.sendMessage(jid, {
      react: {
        text: m.body ?? "",
        key: {
          remoteJid: jid,
          id: target.external_id,
          fromMe: target.direction === "outbound",
        },
      },
    });
    return { id: result?.key.id, content: result?.message ?? null };
  }

  // Sello de "Reenviado". WhatsApp lo dibuja a partir del contextInfo, no de
  // un tipo de mensaje aparte: una copia con esto puesto se ve exactamente
  // igual que un reenvío hecho desde el teléfono. Los audios y los stickers
  // no aceptan contextInfo, así que ahí el sello no va.
  const forwardedContext = m.forwarded
    ? { contextInfo: { isForwarded: true, forwardingScore: 1 } }
    : {};

  // Media: download from Storage, send via the right Baileys helper.
  if (m.type !== "text") {
    if (!m.media_url) throw new Error("media message without media_url");
    const buffer = await downloadStorageBuffer(m.media_url);
    if (!buffer) throw new Error("could not fetch media from storage");

    const caption = m.body ?? undefined;
    const mime = m.media_mime ?? undefined;
    const fileName = m.media_filename ?? undefined;

    let result: Awaited<ReturnType<typeof currentSock.sendMessage>>;
    switch (m.type) {
      case "image":
        result = await currentSock.sendMessage(jid, {
          image: buffer,
          caption,
          mimetype: mime,
          ...forwardedContext,
        });
        break;
      case "video":
        result = await currentSock.sendMessage(jid, {
          video: buffer,
          caption,
          mimetype: mime,
          ...forwardedContext,
        });
        break;
      case "audio":
        result = await currentSock.sendMessage(jid, {
          audio: buffer,
          mimetype: mime ?? "audio/ogg; codecs=opus",
          ptt: true,
        });
        break;
      case "document":
        // Intentionally NOT forwarding `caption` here. Baileys wraps a
        // captioned document as `documentWithCaptionMessage` (a newer
        // protocol message type), which several recipient WhatsApp
        // clients render as "Esperando este mensaje…" because they
        // don't decode that shape. If a caption is set we send it as a
        // separate plain-text message AFTER the document instead.
        result = await currentSock.sendMessage(jid, {
          document: buffer,
          fileName: fileName ?? "archivo",
          mimetype: mime ?? "application/octet-stream",
          ...forwardedContext,
        });
        if (caption && caption.trim().length > 0) {
          await currentSock.sendMessage(jid, { text: caption });
        }
        break;
      case "sticker":
        result = await currentSock.sendMessage(jid, {
          sticker: buffer,
        });
        break;
      default:
        throw new Error(`unsupported media type: ${m.type}`);
    }
    return { id: result?.key.id, content: result?.message ?? null };
  }

  // Plain text
  if (!m.body) throw new Error("text message without body");
  const result = await currentSock.sendMessage(jid, {
    text: m.body,
    ...forwardedContext,
  });
  return { id: result?.key.id, content: result?.message ?? null };
}

/**
 * Errores que significan "el socket se cayó", no "este mensaje es inválido".
 * Se reencolan para el próximo tick en vez de darlos por perdidos.
 */
function isTransientSendError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("connection closed") ||
    m.includes("connection terminated") ||
    m.includes("connection lost") ||
    m.includes("timed out") ||
    m.includes("no_sock")
  );
}

async function pollOutgoing() {
  if (!isSocketAlive()) return;

  const { data: queued, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, type, body, media_url, media_mime, media_filename, reaction_target_external_id, forwarded, conversations!inner(external_id, channel)",
    )
    .eq("status", "queued")
    .eq("direction", "outbound")
    // Filtrar por canal ACÁ y no sólo en el loop. Sin esto la consulta traía
    // los 10 más viejos de cualquier canal y los de Instagram —que este worker
    // saltea— se comían la ventana entera: había 12 mensajes de IG trabados
    // desde el 8/8 y ningún mensaje de WhatsApp volvía a salir nunca.
    .eq("conversations.channel", "whatsapp")
    // Un mensaje al que le cancelaron el envío antes de que saliera queda
    // 'queued' con `revoked_at` puesto: es la forma de que no salga nunca.
    .is("revoked_at", null)
    .order("sent_at")
    .limit(10);

  if (error) {
    console.error("[poller] select error:", error);
    return;
  }
  if (!queued || queued.length === 0) return;

  for (const m of queued as unknown as QueuedMessage[]) {
    const conv = m.conversations;
    if (!conv || conv.channel !== "whatsapp") continue;

    const { data: claim } = await supabase
      .from("messages")
      .update({ status: "sending" })
      .eq("id", m.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claim) continue;

    try {
      const { id: externalId, content } = await sendOutgoing(
        m,
        conv.external_id,
      );
      // Persist the proto.IMessage content so we can answer retry-receipts
      // via `getMessage` later (the linked-device "Esperando este mensaje"
      // fix). Encoded with protobuf so Uint8Array fields survive the
      // round-trip through JSONB.
      const { data: saved } = await supabase
        .from("messages")
        .update({
          status: "sent",
          external_id: externalId ?? null,
          sent_at: new Date().toISOString(),
          wa_content: content
            ? { b64: encodeWaMessageContent(content) }
            : null,
        })
        .eq("id", m.id)
        .select("revoked_at")
        .maybeSingle();
      console.log("→ sent", m.type, m.id, "to", conv.external_id);

      // Cancelaron el envío mientras el mensaje estaba saliendo: llegó igual,
      // así que lo borramos del otro lado en el acto. Sin esto la bandeja lo
      // muestra eliminado y en el teléfono de la clienta queda para siempre.
      if (saved?.revoked_at && externalId) {
        await currentSock?.sendMessage(conv.external_id, {
          delete: { remoteJid: conv.external_id, id: externalId, fromMe: true },
        });
        console.log("→ cancelado sobre la hora, eliminado para todos", m.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTransientSendError(msg)) {
        // El socket se cayó a mitad del envío. Volvemos a 'queued' para que
        // salga cuando reconecte — antes se marcaba 'failed' y el mensaje
        // quedaba muerto aunque WhatsApp estuviera por volver.
        console.warn("→ send diferido (conexión caída)", m.id, msg);
        await supabase
          .from("messages")
          .update({ status: "queued" })
          .eq("id", m.id);
        return;
      }
      console.error("→ send failed", m.id, msg);
      await supabase
        .from("messages")
        .update({
          status: "failed",
          error: msg.slice(0, 500),
          failed_at: new Date().toISOString(),
        })
        .eq("id", m.id);
    }
  }
}

setInterval(() => void pollOutgoing(), 2000);

// ─────────────────────────────────────────── Editar / eliminar

type QueuedOp = {
  id: string;
  message_id: string;
  op: string;
  body: string | null;
  messages: { external_id: string | null } | null;
  conversations: { external_id: string; channel: string } | null;
};

/**
 * Cola de operaciones sobre mensajes ya mandados: editar el texto y eliminar
 * para todos. Va aparte de `pollOutgoing` porque no son mensajes nuevos —no
 * llevan burbuja ni tocan la vista previa del chat— sino cambios sobre uno
 * que ya existe de los dos lados.
 *
 * La bandeja ya dejó el mensaje editado/eliminado en la base antes de encolar
 * esto (igual que WhatsApp Web, que cambia la burbuja en el acto): acá sólo
 * falta que se entere el teléfono de la clienta.
 */
async function pollMessageOps() {
  if (!isSocketAlive()) return;

  const { data: pending, error } = await supabase
    .from("message_ops")
    .select(
      "id, message_id, op, body, messages!inner(external_id), conversations!inner(external_id, channel)",
    )
    .eq("status", "queued")
    // Mismo bloqueo de cabecera que en `pollOutgoing`: si las 10 ops más viejas
    // son de otro canal, las de WhatsApp no se procesan nunca.
    .eq("conversations.channel", "whatsapp")
    .order("created_at")
    .limit(10);

  if (error) {
    console.error("[ops] select error:", error);
    return;
  }
  if (!pending || pending.length === 0) return;

  for (const op of pending as unknown as QueuedOp[]) {
    const conv = op.conversations;
    if (!conv || conv.channel !== "whatsapp") continue;

    const { data: claim } = await supabase
      .from("message_ops")
      .update({ status: "sending" })
      .eq("id", op.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claim) continue;

    try {
      // Igual que en `sendOutgoing`: si el socket se cayó entre el fetch y
      // ahora, esto es un error transitorio y no una operación inválida.
      if (!currentSock) throw new Error("no_sock");

      const externalId = op.messages?.external_id ?? null;
      const key = externalId
        ? { remoteJid: conv.external_id, id: externalId, fromMe: true }
        : null;

      if (!key) {
        // Nunca llegó a salir (se canceló mientras estaba en la cola). No hay
        // nada que borrar ni editar del otro lado: la operación ya se cumplió
        // con el `revoked_at` que puso la bandeja.
        console.log("→ op sin destino remoto, nada que hacer", op.id);
      } else if (op.op === "revoke") {
        await currentSock.sendMessage(conv.external_id, { delete: key });
        console.log("→ eliminado para todos", op.message_id);
      } else if (op.op === "edit") {
        if (!op.body) throw new Error("edit sin texto");
        await currentSock.sendMessage(conv.external_id, {
          text: op.body,
          edit: key,
        });
        console.log("→ editado", op.message_id);
      } else {
        throw new Error(`operación desconocida: ${op.op}`);
      }

      await supabase
        .from("message_ops")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("id", op.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTransientSendError(msg)) {
        console.warn("→ op diferida (conexión caída)", op.id, msg);
        await supabase
          .from("message_ops")
          .update({ status: "queued" })
          .eq("id", op.id);
        return;
      }
      console.error("→ op falló", op.id, msg);
      await supabase
        .from("message_ops")
        .update({
          status: "failed",
          error: msg.slice(0, 500),
          processed_at: new Date().toISOString(),
        })
        .eq("id", op.id);
    }
  }
}

setInterval(() => void pollMessageOps(), 2000);

// Automation tick — runs every 60s. Independent of pollOutgoing since
// automations just enqueue messages that the regular poller picks up.
setInterval(() => void processAutomations(supabase), 60_000);

// ─────────────────────────────────────────── Connection lifecycle

async function connect() {
  if (connecting) return;
  connecting = true;
  try {
    await updateStatus({ state: "connecting", last_error: null });

    const { state, saveCreds } = await useSupabaseAuthState(
      supabase,
      SESSION_ID,
    );
    const { version } = await fetchLatestBaileysVersion();

    console.log(`📡 Conectando a WhatsApp (Baileys ${version.join(".")})...`);

    const sock = makeWASocket({
      version,
      auth: state,
      syncFullHistory: false,
      // Answer retry-receipts from peer devices that failed to decrypt one
      // of our messages (typically the user's own primary phone, when
      // multi-device session drift means our linked-device copy doesn't
      // decode). Without this callback those devices get stuck on
      // "Esperando este mensaje…" forever.
      getMessage: async (
        key: WAMessageKey,
      ): Promise<WAMessageContent | undefined> => {
        if (!key.id) return undefined;
        const { data } = await supabase
          .from("messages")
          .select("wa_content")
          .eq("external_id", key.id)
          .maybeSingle();
        const stored = data?.wa_content as { b64?: string } | null;
        if (!stored?.b64) return undefined;
        try {
          return decodeWaMessageContent(stored.b64);
        } catch (err) {
          console.warn(
            "[getMessage] could not decode wa_content for",
            key.id,
            err instanceof Error ? err.message : err,
          );
          return undefined;
        }
      },
    });
    currentSock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(
          "📱 QR generado — abrilo desde /configuracion en el navegador para escanearlo.",
        );
        qrcode.generate(qr, { small: true });
        await updateStatus({ state: "qr", qr });
      }

      if (connection === "open") {
        console.log(`✓ Conectado como ${sock.user?.id ?? "?"}`);
        await updateStatus({
          state: "connected",
          qr: null,
          phone_number: sock.user?.id ?? null,
          last_connected_at: new Date().toISOString(),
          last_error: null,
        });
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = reason === DisconnectReason.loggedOut;

        // El cierre puede llegar tarde, de un socket que ya reemplazamos. Si no
        // es el socket vigente, no tocamos nada: antes esto ponía
        // `currentSock = null` con el socket nuevo vivo (los pollers se
        // frenaban y la UI lo veía caído) y encima disparaba otro connect(),
        // dejando dos sockets sobre las mismas creds peleándose — de ahí las
        // rachas de 428/440/503 en los logs.
        if (currentSock !== sock) {
          console.log(
            `Cierre de un socket viejo (${reason ?? "?"}). Ignorado: ya hay otro activo.`,
          );
          return;
        }
        currentSock = null;

        if (loggedOut && !loggingOut) {
          // Stale or revoked creds → auto-clean and reconnect with a fresh QR
          // so the UI doesn't get stuck. Only skip when the user themselves
          // initiated the logout via the UI (`loggingOut` flag).
          console.log(
            `⚠️  Sesión inválida (${reason}). Limpiando creds y reintentando con QR nuevo...`,
          );
          await clearStoredCreds();
          await updateStatus({
            state: "connecting",
            qr: null,
            last_error: null,
          });
          setTimeout(() => void connect(), 1500);
          return;
        }

        console.log(
          `Conexión cerrada (${reason ?? "?"}).${loggedOut ? " (logout intencional)" : " Reconectando en 2s..."}`,
        );
        await updateStatus({
          state: "disconnected",
          qr: null,
          last_error: loggedOut ? null : `Desconectado (${reason ?? "?"})`,
        });
        if (!loggedOut && !loggingOut) {
          setTimeout(() => void connect(), 2000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // 'notify' = mensaje que entra en vivo.
      // 'append' = mensaje que WhatsApp tenía encolado y nos entrega al
      //            reconectar (Baileys lo marca así cuando el nodo trae
      //            attrs.offline).
      //
      // Antes descartábamos 'append', así que TODO lo que llegaba mientras el
      // worker estaba caído o reconectando se descifraba y se tiraba en
      // silencio: la sesión quedaba "conectada" y el CRM vacío. Ingerimos los
      // dos tipos; el dedupe por external_id de abajo cubre las reentregas.
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        try {
          // Reactions arrive embedded as reactionMessage; handle separately
          // so we can store them as type='reaction' instead of plain media.
          if (msg.message?.reactionMessage) {
            await handleIncomingReaction(msg);
          } else {
            await handleUpsertedMessage(msg);
          }
        } catch (err) {
          console.error("[messages.upsert] error:", err);
        }
      }
    });

    // Some Baileys events surface reactions via a dedicated channel.
    // Listening to both means we don't lose any depending on protocol path.
    sock.ev.on("messages.reaction", async (reactions) => {
      for (const r of reactions) {
        try {
          await storeInboundReaction({
            remoteJid: r.key.remoteJid ?? null,
            targetExternalId: r.key.id ?? null,
            targetFromMe: !!r.key.fromMe,
            emoji: r.reaction?.text ?? "",
            timestampMs: r.reaction?.senderTimestampMs
              ? Number(r.reaction.senderTimestampMs)
              : undefined,
          });
        } catch (err) {
          console.error("[messages.reaction] error:", err);
        }
      }
    });

    sock.ev.on("messages.update", async (updates) => {
      for (const u of updates) {
        const externalId = u.key.id;
        if (!externalId) continue;
        const update = u.update;

        // Eliminado para todos y edición llegan por acá, ya sea porque los
        // hizo la clienta o porque los hicimos nosotros desde el teléfono del
        // salón. Baileys traduce el protocolMessage a este evento.
        if (update.messageStubType === WAMessageStubType.REVOKE) {
          await applyRemoteRevoke(u.key.remoteJid ?? null, externalId);
          continue;
        }
        const edited = update.message?.editedMessage?.message;
        if (edited) {
          await applyRemoteEdit(u.key.remoteJid ?? null, externalId, edited);
          continue;
        }

        if (typeof update.status === "number") {
          const statusMap: Record<number, "sent" | "delivered" | "read"> = {
            2: "sent",
            3: "delivered",
            4: "read",
          };
          const status = statusMap[update.status];
          if (!status) continue;
          const patches: Database["public"]["Tables"]["messages"]["Update"] = {
            status,
          };
          if (status === "delivered")
            patches.delivered_at = new Date().toISOString();
          if (status === "read") patches.read_at = new Date().toISOString();
          await supabase
            .from("messages")
            .update(patches)
            .eq("external_id", externalId);
        }
      }
    });
  } finally {
    connecting = false;
  }
}

void connect();

process.on("SIGINT", () => {
  console.log("\n👋 Cerrando worker...");
  currentSock?.end(undefined);
  process.exit(0);
});
