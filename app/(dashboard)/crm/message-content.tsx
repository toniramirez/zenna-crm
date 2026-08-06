"use client";

import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Pause,
  Play,
  Video,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MessageRow } from "./types";
import { useSignedUrl } from "./use-signed-url";

/**
 * Contenido de una burbuja.
 *
 * Ojo: ya no recibe `isOutbound`. En WhatsApp las dos burbujas son claras
 * (blanca la entrante, verde agua la saliente) y la tinta es la misma
 * `--wa-text` en ambas, así que no hay nada que invertir. Lo que necesita
 * contraste propio (botones, barras) se resuelve con `currentColor`.
 */
export function MessageContent({ message }: { message: MessageRow }) {
  if (message.type === "text" || !message.media_url) {
    if (!message.body) return null;
    return (
      <div className="whitespace-pre-wrap break-words text-sm">
        {message.body}
      </div>
    );
  }
  if (message.type === "image" || message.type === "sticker") {
    return <ImageContent message={message} />;
  }
  if (message.type === "video") {
    return <VideoContent message={message} />;
  }
  if (message.type === "audio") {
    return <AudioContent message={message} />;
  }
  if (message.type === "document") {
    return <DocumentContent message={message} />;
  }
  return null;
}

// ──────────────────────────── Image / Sticker

function ImageContent({ message }: { message: MessageRow }) {
  const url = useSignedUrl(message.media_url);
  const [open, setOpen] = useState(false);
  const isSticker = message.type === "sticker";

  return (
    <>
      <div
        className={cn(
          "overflow-hidden cursor-zoom-in -mx-2 -mt-1",
          isSticker
            ? "max-w-[140px]"
            : "rounded-lg max-w-[280px] bg-black/5 dark:bg-white/5",
        )}
        onClick={() => url && setOpen(true)}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={message.body ?? "Imagen"}
            className={cn(
              "block w-full h-auto",
              isSticker ? "bg-transparent" : "max-h-[320px] object-cover",
            )}
          />
        ) : (
          <div className="aspect-video grid place-items-center text-[var(--wa-text-3)]">
            <ImageIcon className="size-6" />
          </div>
        )}
      </div>
      {message.body ? (
        <div className="whitespace-pre-wrap break-words text-sm mt-1">
          {message.body}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2 bg-black/95 border-0">
          <DialogTitle className="sr-only">Imagen ampliada</DialogTitle>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={message.body ?? "Imagen ampliada"}
              className="w-full h-auto max-h-[85vh] object-contain rounded"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────── Video

function VideoContent({ message }: { message: MessageRow }) {
  const url = useSignedUrl(message.media_url);
  return (
    <>
      <div className="rounded-lg overflow-hidden bg-black -mx-2 -mt-1 max-w-[320px]">
        {url ? (
          <video
            src={url}
            controls
            className="block w-full h-auto max-h-[360px]"
            preload="metadata"
          />
        ) : (
          <div className="aspect-video grid place-items-center bg-black/5 text-[var(--wa-text-3)] dark:bg-white/5">
            <Video className="size-6" />
          </div>
        )}
      </div>
      {message.body ? (
        <div className="whitespace-pre-wrap break-words text-sm mt-1">
          {message.body}
        </div>
      ) : null}
    </>
  );
}

// ──────────────────────────── Audio

function formatAudioTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AudioContent({ message }: { message: MessageRow }) {
  const url = useSignedUrl(message.media_url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      Math.max((e.clientX - rect.left) / rect.width, 0),
      1,
    );
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const total = duration > 0 ? duration : 0;
  const remaining = total > 0 ? Math.max(total - currentTime, 0) : 0;
  const showTime = playing || currentTime > 0 ? currentTime : remaining;

  return (
    <div className="flex min-w-[180px] max-w-[260px] items-center gap-2 py-0.5 text-[var(--wa-text)]">
      <button
        type="button"
        onClick={togglePlay}
        disabled={!url}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-[var(--wa-icon)] transition-colors",
          "bg-black/5 hover:bg-black/10 active:bg-black/15",
          "dark:bg-white/10 dark:hover:bg-white/15 dark:active:bg-white/20",
          !url && "opacity-50 cursor-wait",
        )}
        aria-label={playing ? "Pausar" : "Reproducir"}
      >
        {!url ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5 translate-x-[1px]" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          onClick={seek}
          className="relative h-[3px] cursor-pointer rounded-full bg-black/15 dark:bg-white/20"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--wa-accent)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] leading-none tabular-nums text-[var(--wa-meta)]">
            {formatAudioTime(showTime)}
          </span>
        </div>
      </div>

      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          hidden
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
        />
      ) : null}
    </div>
  );
}

// ──────────────────────────── Document

function DocumentContent({ message }: { message: MessageRow }) {
  const url = useSignedUrl(message.media_url);
  const filename =
    message.media_filename ?? message.media_url?.split("/").pop() ?? "archivo";

  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      download={filename}
      className={cn(
        "flex items-center gap-3 min-w-[200px] max-w-[300px] rounded-md border border-current/20 px-3 py-2 hover:bg-current/5 transition-colors",
        !url && "pointer-events-none opacity-60",
      )}
    >
      <FileText className="size-5 shrink-0 opacity-70" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm font-medium truncate">{filename}</div>
        <div className="text-xs opacity-70">
          {message.media_mime?.split("/")[1]?.toUpperCase() ?? "Documento"}
        </div>
      </div>
      {url ? (
        <Download className="size-4 opacity-60 shrink-0" />
      ) : (
        <Loader2 className="size-4 animate-spin opacity-60 shrink-0" />
      )}
    </a>
  );
}
