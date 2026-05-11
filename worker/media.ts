import type { SupabaseClient } from "@supabase/supabase-js";
import {
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Database } from "@/types/database.types";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/ogg; codecs=opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

function mimeToExt(mime: string | null | undefined): string {
  if (!mime) return "bin";
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXT[base] ?? "bin";
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export type MediaResult = {
  type: MediaKind;
  caption: string | null;
  path: string | null;
  mime: string | null;
  filename: string | null;
};

type Classification = {
  kind: MediaKind | null;
  // baileys gives us untyped media descriptors; we only read a few fields
  // (mimetype, caption, fileName) so a loose record is enough.
  mediaContent: Record<string, unknown> | null;
  caption: string | null;
  filename: string | null;
};

function classifyMessage(msg: WAMessage): Classification {
  const m = msg.message;
  if (!m) {
    return { kind: null, mediaContent: null, caption: null, filename: null };
  }
  if (m.imageMessage) {
    return {
      kind: "image",
      mediaContent: m.imageMessage as Record<string, unknown>,
      caption: m.imageMessage.caption ?? null,
      filename: null,
    };
  }
  if (m.videoMessage) {
    return {
      kind: "video",
      mediaContent: m.videoMessage as Record<string, unknown>,
      caption: m.videoMessage.caption ?? null,
      filename: null,
    };
  }
  if (m.audioMessage) {
    return {
      kind: "audio",
      mediaContent: m.audioMessage as Record<string, unknown>,
      caption: null,
      filename: null,
    };
  }
  if (m.documentMessage) {
    return {
      kind: "document",
      mediaContent: m.documentMessage as Record<string, unknown>,
      caption: m.documentMessage.caption ?? null,
      filename: m.documentMessage.fileName ?? null,
    };
  }
  if (m.stickerMessage) {
    return {
      kind: "sticker",
      mediaContent: m.stickerMessage as Record<string, unknown>,
      caption: null,
      filename: null,
    };
  }
  return { kind: null, mediaContent: null, caption: null, filename: null };
}

export async function downloadAndStoreMedia(
  supabase: SupabaseClient<Database>,
  sock: WASocket,
  msg: WAMessage,
  conversationId: string,
): Promise<MediaResult | null> {
  const cls = classifyMessage(msg);
  if (!cls.kind || !cls.mediaContent) return null;

  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      {
        // baileys types reuploadRequest as `WASocket['updateMediaMessage']`
        reuploadRequest: sock.updateMediaMessage,
        // suppress noisy default logging
        logger: undefined as never,
      },
    );

    if (!Buffer.isBuffer(buffer)) {
      console.error("[media] downloadMediaMessage didn't return a buffer");
      return null;
    }

    const mime = (cls.mediaContent.mimetype as string | undefined) ?? null;
    const ext = cls.filename
      ? (cls.filename.split(".").pop() ?? mimeToExt(mime))
      : mimeToExt(mime);
    const messageId = msg.key.id ?? Math.random().toString(36).slice(2);
    const path = `media/${conversationId}/${messageId}.${ext}`;

    const { error } = await supabase.storage
      .from("wa-media")
      .upload(path, buffer, {
        contentType: mime ?? "application/octet-stream",
        upsert: true,
      });

    if (error) {
      console.error("[media] storage upload error:", error.message);
      return null;
    }

    return {
      type: cls.kind,
      caption: cls.caption,
      path,
      mime,
      filename: cls.filename,
    };
  } catch (err) {
    console.error(
      "[media] download/upload failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Fetch the contact's WhatsApp profile picture (if visible) and cache it in
 * our own Storage bucket. Stores the path on `conversations.avatar_path`.
 * Fails silently — many users keep their picture private and that's fine.
 *
 * When the chat JID is an `@lid` (privacy-preserving), `profilePictureUrl`
 * often refuses; if we know the real phone digits we retry against the
 * `<digits>@s.whatsapp.net` JID, which more reliably resolves.
 */
export async function fetchAndStoreAvatar(
  supabase: SupabaseClient<Database>,
  sock: WASocket,
  jid: string,
  conversationId: string,
  phoneDigits?: string | null,
): Promise<void> {
  const candidateJids: string[] = [jid];
  if (jid.endsWith("@lid") && phoneDigits && phoneDigits.length >= 8) {
    candidateJids.push(`${phoneDigits}@s.whatsapp.net`);
  }

  let url: string | undefined;
  for (const candidate of candidateJids) {
    try {
      const got = await sock.profilePictureUrl(candidate, "image");
      if (got) {
        url = got;
        break;
      }
    } catch {
      // Private picture or unauthorized for this JID — try the next candidate.
    }
  }
  if (!url) return;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buffer = Buffer.from(await res.arrayBuffer());

    // Prefer the real phone for the storage key so a later LID change for the
    // same contact still hits the same avatar file.
    const keyDigits =
      phoneDigits && phoneDigits.length >= 8
        ? phoneDigits
        : jid.split("@")[0]?.replace(/\D/g, "") || "anon";
    const path = `avatars/${keyDigits}.jpg`;

    const { error } = await supabase.storage
      .from("wa-media")
      .upload(path, buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) {
      console.error("[avatar] storage upload error:", error.message);
      return;
    }
    await supabase
      .from("conversations")
      .update({ avatar_path: path })
      .eq("id", conversationId);
  } catch {
    // Network or storage glitch — skip silently.
  }
}
