import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Transcribe an audio buffer via OpenAI Whisper API (whisper-1). Returns
 * the recognised text or null on failure. Audio is sent as multipart form
 * so we don't need to write a temp file.
 */
async function whisperTranscribe(
  buffer: Buffer,
  mime: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[transcribe] OPENAI_API_KEY no configurada — saltando transcripción.",
    );
    return null;
  }

  // WhatsApp voice notes come as audio/ogg; codecs=opus. The filename hint
  // helps OpenAI's content-type sniffer pick the right decoder.
  const ext =
    mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : mime.includes("webm")
          ? "webm"
          : "audio";
  const filename = `audio.${ext}`;

  const form = new FormData();
  // Copy into a fresh ArrayBuffer to satisfy Blob's BlobPart type, which
  // rejects ArrayBufferLike (the Buffer's underlying buffer might in
  // principle be a SharedArrayBuffer). One alloc per audio is negligible.
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  form.append("file", new Blob([ab], { type: mime }), filename);
  form.append("model", "whisper-1");
  form.append("language", "es");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[transcribe] OpenAI HTTP", res.status, text.slice(0, 300));
    return null;
  }

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() || null;
}

/**
 * Wrapper that updates the message row with the transcription status
 * lifecycle. Self-contained — downloads the audio from Storage itself so
 * callers only need to know the message id + storage path.
 *
 * Safe to fire-and-forget from the message-insert path.
 */
export async function transcribeAndStore(
  supabase: SupabaseClient<Database>,
  messageId: string,
  mediaPath: string,
  mime: string,
): Promise<void> {
  await supabase
    .from("messages")
    .update({ transcription_status: "pending" })
    .eq("id", messageId);

  let text: string | null = null;
  try {
    const { data, error } = await supabase.storage
      .from("wa-media")
      .download(mediaPath);
    if (error || !data) {
      console.error(
        "[transcribe] could not fetch media from storage:",
        error?.message,
      );
    } else {
      const buffer = Buffer.from(await data.arrayBuffer());
      text = await whisperTranscribe(buffer, mime);
    }
  } catch (err) {
    console.error(
      "[transcribe] unexpected error:",
      err instanceof Error ? err.message : err,
    );
  }

  if (text) {
    await supabase
      .from("messages")
      .update({ transcription: text, transcription_status: "completed" })
      .eq("id", messageId);
    console.log(
      `→ transcribed ${messageId}:`,
      text.slice(0, 80) + (text.length > 80 ? "…" : ""),
    );
  } else {
    await supabase
      .from("messages")
      .update({ transcription_status: "failed" })
      .eq("id", messageId);
  }
}
