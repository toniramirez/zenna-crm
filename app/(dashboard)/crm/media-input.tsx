"use client";

import {
  FileText,
  ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Square,
  Video,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database.types";
import { sendMediaMessageAction } from "./actions";

type MediaType = Database["public"]["Enums"]["message_type"];

const MAX_FILE_MB = 30;

function classify(mime: string): MediaType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "application/pdf": "pdf",
  };
  return map[mime.split(";")[0]?.toLowerCase() ?? ""] ?? "bin";
}

/** "0:07", "1:32": el reloj de una grabación en curso. */
export function formatRecElapsed(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export type MediaSender = ReturnType<typeof useMediaSender>;

/**
 * El envío de adjuntos y audios, sin botones. Va aparte de `MediaInput`
 * porque el teléfono reparte los mismos gestos en otros lugares de la barra
 * (el clip dentro del "+", el micrófono a la derecha, como en WhatsApp) y los
 * dos caminos tienen que terminar en el mismo upload + encolado.
 */
export function useMediaSender(conversationId: string) {
  const [isPending, startTransition] = useTransition();
  const [recording, setRecording] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const [recElapsedSec, setRecElapsedSec] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function uploadAndSend(
    blob: Blob,
    type: MediaType,
    mime: string,
    filename: string | null,
  ) {
    const supabase = createClient();
    const ext = extFromMime(mime) || (filename?.split(".").pop() ?? "bin");
    const path = `outbound/${conversationId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("wa-media")
      .upload(path, blob, { contentType: mime, upsert: false });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const result = await sendMediaMessageAction({
      conversationId,
      type,
      mediaPath: path,
      mediaMime: mime,
      mediaFilename: filename,
    });
    if (result.error) throw new Error(result.error);
  }

  /** Devuelve si el archivo se aceptó (y ya está subiendo). */
  function sendFiles(
    files: FileList | null,
    restrictType?: "image",
  ): boolean {
    if (!files || files.length === 0) return false;
    const file = files[0];
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`El archivo supera ${MAX_FILE_MB} MB.`);
      return false;
    }
    const mime = file.type || "application/octet-stream";
    if (restrictType === "image" && !mime.startsWith("image/")) {
      toast.error("Elegí una imagen.");
      return false;
    }

    startTransition(async () => {
      try {
        await uploadAndSend(file, classify(mime), mime, file.name || null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "No pudimos enviar el archivo.",
        );
      }
    });
    return true;
  }

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        // Stop tracks immediately so the browser's mic indicator turns off.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        chunksRef.current = [];

        // Discard recordings shorter than 0.4s — usually accidental taps.
        if (blob.size < 800) {
          toast.info("Audio demasiado corto, no se envió.");
          return;
        }

        startTransition(async () => {
          try {
            await uploadAndSend(blob, "audio", mime, null);
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "No pudimos enviar el audio.",
            );
          }
        });
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecording(true);
      setRecElapsedSec(0);
      recTimerRef.current = setInterval(() => {
        setRecElapsedSec(
          Math.floor((Date.now() - startedAtRef.current) / 1000),
        );
      }, 250);
    } catch {
      toast.error("No pudimos acceder al micrófono.");
    }
  }

  function stopRecording(cancel = false) {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (cancel) {
      // Discard: wire ondataavailable/onstop to be no-ops, then stop.
      recorder.ondataavailable = null;
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        chunksRef.current = [];
      };
    }
    if (recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    setRecElapsedSec(0);
  }

  /*
    Cambiar de chat (o volver a la lista) con el micrófono abierto descarta la
    grabación. Sin esto el audio seguía grabándose sin nada en pantalla que lo
    dijera, y al cortarlo salía para la conversación donde había empezado.
  */
  useEffect(
    () => () => stopRecording(true),
    // Sólo el cambio de chat: `stopRecording` trabaja con refs y setters.
    [conversationId],
  );

  return {
    isPending,
    recording,
    recElapsedSec,
    sendFiles,
    startRecording,
    stopRecording,
  };
}

/**
 * Bottom-row input controls — paperclip for file pick, mic for voice
 * recording. Both flows share the same upload+enqueue pipeline so the
 * worker treats them identically.
 */
export function MediaInput({
  conversationId,
  disabled,
}: {
  conversationId: string;
  disabled?: boolean;
}) {
  const {
    isPending,
    recording,
    recElapsedSec,
    sendFiles,
    startRecording,
    stopRecording,
  } = useMediaSender(conversationId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  function handleFiles(files: FileList | null, restrictType?: "image") {
    if (sendFiles(files, restrictType)) setPickerOpen(false);
  }

  // While recording, the input bar collapses to a recorder UI
  if (recording) {
    const mm = String(Math.floor(recElapsedSec / 60)).padStart(2, "0");
    const ss = String(recElapsedSec % 60).padStart(2, "0");
    return (
      <div className="flex items-center gap-2 rounded-full border bg-rose-50 px-3 py-1.5">
        <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
        <span className="text-sm font-medium tabular-nums text-rose-900">
          Grabando · {mm}:{ss}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => stopRecording(true)}
          className="text-rose-700"
        >
          <X className="size-4" />
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => stopRecording(false)}
        >
          <Square className="size-4" />
          Enviar
        </Button>
      </div>
    );
  }

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || isPending}
            aria-label="Adjuntar"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-44 p-1"
          side="top"
        >
          <button
            type="button"
            className={cn(
              "w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-muted",
            )}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageIcon className="size-4 text-emerald-600" />
            Foto
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-muted"
            onClick={() => fileInputRef.current?.click()}
          >
            <Video className="size-4 text-sky-600" />
            Video
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-muted"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText className="size-4 text-amber-600" />
            Documento
          </button>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={startRecording}
        disabled={disabled || isPending}
        aria-label="Grabar audio"
      >
        <Mic className="size-4" />
      </Button>

      {/* Hidden inputs — one only for images so the OS picker pre-filters,
          one generic for video/doc/anything. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, "image")}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}
