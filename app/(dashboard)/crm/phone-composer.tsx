"use client";

import {
  Camera,
  ChevronLeft,
  FileText,
  Images,
  LayoutTemplate,
  Loader2,
  type LucideIcon,
  Mic,
  Plus,
  Send,
  Trash2,
  Wand2,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { QuickReply } from "./config-types";
import { formatRecElapsed, type MediaSender } from "./media-input";

/*
  La barra de escritura del teléfono, calcada de WhatsApp para iOS:

    [+]  [ campo ancho ]  [cámara] (mic)      ← vacía
    [+]  [ campo ancho ............ ] (➤)     ← con texto

  Las medidas salen de una captura de WhatsApp en el mismo teléfono: barra de
  48px, campo de 28px de alto que ocupa ~68% del ancho, botón verde de 32px.
  Todo lo demás (adjuntar, mensajes rápidos, plantillas) vive dentro del "+",
  y los emojis los pone el teclado del teléfono.

  Los botones miden lo mismo que un renglón del campo (28px) para que, con la
  barra alineada abajo, queden centrados con el campo de una línea; el área de
  toque se estira hacia arriba y hacia abajo con un `before:` invisible.
*/
const BAR_BUTTON =
  "relative flex h-7 shrink-0 items-center justify-center text-[var(--wa-text)] before:absolute before:inset-x-0 before:-inset-y-2.5 active:opacity-60 disabled:opacity-40";

/**
 * El botón verde redondo del borde derecho: micrófono con la barra vacía,
 * enviar con texto. Mide 32px contra los 28px del campo, así que baja 2px
 * para quedar centrado con un renglón.
 */
export const PHONE_ROUND_BUTTON =
  "-mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--wa-badge)] text-[var(--wa-badge-text)] active:opacity-80 disabled:opacity-40";

/**
 * El "+" de la izquierda. Abre una hoja desde abajo, como la de adjuntar de
 * WhatsApp, con todo lo que en la compu son íconos sueltos en la barra.
 */
export function PhoneAttachButton({
  media,
  quickReplies,
  onQuickReply,
  onOpenTemplates,
  disabled,
}: {
  media: MediaSender;
  quickReplies: QuickReply[];
  onQuickReply: (body: string) => void;
  /** Ausente si el canal no tiene plantillas aprobadas. */
  onOpenTemplates?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** La hoja muestra el menú o, un paso más adentro, los mensajes rápidos. */
  const [view, setView] = useState<"menu" | "replies">("menu");
  // Los selectores de archivo viven afuera de la hoja: la hoja se cierra al
  // tocar la opción y, si estuvieran adentro, se desmontarían antes de que el
  // teléfono devuelva el archivo elegido.
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setView("menu");
  }

  function pickFrom(input: HTMLInputElement | null) {
    input?.click();
    handleOpenChange(false);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Adjuntar, mensajes rápidos y plantillas"
        onClick={() => setOpen(true)}
        disabled={disabled || media.isPending}
        className={cn(BAR_BUTTON, "w-10")}
      >
        {media.isPending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Plus className="size-7" strokeWidth={1.5} />
        )}
      </button>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          media.sendFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={documentRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          media.sendFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Sin autofoco: en el teléfono bajaría el teclado y la hoja
          // saltaría apenas abre.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="bottom-[calc(0px-var(--vp-gap))] gap-0 rounded-t-3xl border-border pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetTitle className="sr-only">
            {view === "menu" ? "Adjuntar" : "Mensajes rápidos"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {view === "menu"
              ? "Fotos, documentos, mensajes rápidos y plantillas"
              : "Elegí un mensaje para cargarlo en el campo de escritura"}
          </SheetDescription>

          <span
            aria-hidden
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40"
          />

          {view === "menu" ? (
            <div className="py-2">
              <SheetRow
                icon={Images}
                tint="bg-sky-500/15 text-sky-400"
                label="Fotos y videos"
                onClick={() => pickFrom(galleryRef.current)}
              />
              <SheetRow
                icon={FileText}
                tint="bg-violet-500/15 text-violet-400"
                label="Documento"
                onClick={() => pickFrom(documentRef.current)}
              />
              {quickReplies.length > 0 ? (
                <SheetRow
                  icon={Wand2}
                  tint="bg-amber-500/15 text-amber-400"
                  label="Mensajes rápidos"
                  onClick={() => setView("replies")}
                  chevron
                />
              ) : null}
              {onOpenTemplates ? (
                <SheetRow
                  icon={LayoutTemplate}
                  tint="bg-emerald-500/15 text-emerald-400"
                  label="Plantillas de WhatsApp"
                  onClick={() => {
                    handleOpenChange(false);
                    onOpenTemplates();
                  }}
                />
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 px-2 pt-2 pb-1">
                <button
                  type="button"
                  aria-label="Volver"
                  onClick={() => setView("menu")}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full active:bg-muted"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <span className="text-[1.0625rem] font-semibold">
                  Mensajes rápidos
                </span>
              </div>
              <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain">
                {quickReplies.map((qr) => (
                  <li key={qr.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onQuickReply(qr.body);
                        handleOpenChange(false);
                      }}
                      className="w-full px-4 py-2.5 text-left active:bg-muted"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-[0.9375rem] font-medium">
                          {qr.label}
                        </span>
                        {qr.shortcut ? (
                          <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
                            {qr.shortcut}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[0.8125rem] text-muted-foreground">
                        {qr.body}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SheetRow({
  icon: Icon,
  tint,
  label,
  onClick,
  chevron = false,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left text-[0.9375rem] text-foreground active:bg-muted"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          tint,
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {chevron ? (
        <ChevronLeft
          aria-hidden
          className="size-4 rotate-180 text-muted-foreground"
        />
      ) : null}
    </button>
  );
}

/**
 * Cámara y micrófono, los dos botones de la derecha con la barra vacía. Al
 * escribir se retiran y en su lugar queda el de enviar, como en WhatsApp.
 */
export function PhoneMediaButtons({
  media,
  disabled,
}: {
  media: MediaSender;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const busy = disabled || media.isPending;

  return (
    <>
      <button
        type="button"
        aria-label="Sacar una foto"
        onClick={() => cameraRef.current?.click()}
        disabled={busy}
        // Los 6px de más son el aire que deja WhatsApp entre el campo y la
        // cámara, más ancho que el de los otros botones.
        className={cn(BAR_BUTTON, "ml-1.5 w-10")}
      >
        <Camera className="size-[26px]" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Grabar un audio"
        onClick={() => void media.startRecording()}
        disabled={busy}
        className={PHONE_ROUND_BUTTON}
      >
        <Mic className="size-[18px]" strokeWidth={2} />
      </button>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          media.sendFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** La barra mientras se graba un audio: descartar, el reloj y enviar. */
export function PhoneRecordingBar({ media }: { media: MediaSender }) {
  return (
    <div className="flex items-end gap-1 pt-2.5 pr-2.5 pb-[calc(0.5rem+var(--safe-bottom))] pl-1">
      <button
        type="button"
        aria-label="Descartar el audio"
        onClick={() => media.stopRecording(true)}
        className={cn(BAR_BUTTON, "w-10 text-[var(--wa-wait-cold)]")}
      >
        <Trash2 className="size-[22px]" strokeWidth={1.75} />
      </button>
      <div
        role="status"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 px-1"
      >
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
        <span className="text-base tabular-nums">
          {formatRecElapsed(media.recElapsedSec)}
        </span>
        <span className="truncate text-[0.875rem] text-[var(--wa-text-2)]">
          Grabando audio…
        </span>
      </div>
      <button
        type="button"
        aria-label="Enviar el audio"
        onClick={() => media.stopRecording(false)}
        className={PHONE_ROUND_BUTTON}
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}
