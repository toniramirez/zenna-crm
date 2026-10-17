"use client";

import { CalendarPlus, FileText, Hourglass, type LucideIcon } from "lucide-react";
import { PhoneSection, useIsPhone } from "@/components/dashboard/phone-screen";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatWindowLeft } from "@/lib/whatsapp-cloud/window";
import { ChatAvatar } from "./chat-avatar";
import { ChatTagsBar, type LinkedClient } from "./chat-tags-bar";
import type { ClientTag } from "./config-types";
import type { ConversationWithClient } from "./types";

/**
 * La info del contacto, la que abre WhatsApp al tocar el nombre arriba del
 * chat. En el teléfono es una hoja desde abajo y es donde viven las
 * etiquetas: en la cabecera del chat ocupaban un renglón entero de la
 * pantalla. En la compu sale por la derecha, como el panel de WhatsApp Web.
 */
export function ContactSheet({
  open,
  onOpenChange,
  conversation,
  title,
  phone,
  windowLeft,
  allTags,
  onTagsChange,
  onNewTurno,
  onPresupuesto,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithClient;
  title: string;
  phone: string | null;
  /** Lo que queda de la ventana de 24 h; ausente si no aplica o cerró. */
  windowLeft?: number;
  allTags: ClientTag[];
  onTagsChange: (next: string[], linkedClient: LinkedClient) => void;
  onNewTurno: () => void;
  onPresupuesto: () => void;
}) {
  const isPhone = useIsPhone();

  /** Las acciones abren su diálogo recién con la hoja cerrada: no se apilan. */
  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isPhone ? "bottom" : "right"}
        showCloseButton={!isPhone}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "wa-scope gap-0 overflow-y-auto overscroll-contain border-[var(--wa-divider)] bg-[var(--wa-panel)] text-[var(--wa-text)]",
          isPhone
            ? "bottom-[calc(0px-var(--vp-gap))] max-h-[85dvh] rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            : "pb-6",
        )}
      >
        <SheetTitle className="sr-only">Info del contacto</SheetTitle>
        <SheetDescription className="sr-only">
          Datos y etiquetas de {title}
        </SheetDescription>

        {isPhone ? (
          <span
            aria-hidden
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-[var(--wa-text-3)]/40"
          />
        ) : null}

        <div className="flex flex-col items-center px-6 pt-6 text-center">
          <ChatAvatar
            name={title}
            avatarPath={conversation.avatar_path}
            channel={conversation.channel}
            size={88}
          />
          <p className="mt-3 text-[1.375rem] font-semibold leading-tight">
            {title}
          </p>
          {phone && phone !== title ? (
            <p className="mt-1 text-[0.9375rem] tabular-nums text-[var(--wa-text-2)]">
              {phone}
            </p>
          ) : null}
          {!conversation.clients ? (
            <p className="mt-1 text-[0.8125rem] text-[var(--wa-text-3)]">
              Sin clienta asociada
            </p>
          ) : null}
          {windowLeft !== undefined ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--wa-text-2)]">
              <Hourglass className="size-3.5 shrink-0" />
              <span>
                Ventana de 24 h: quedan{" "}
                <strong className="font-medium tabular-nums text-[var(--wa-text)]">
                  {formatWindowLeft(windowLeft)}
                </strong>
              </span>
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 pt-5">
          <ActionTile
            icon={CalendarPlus}
            label="Nuevo turno"
            onClick={() => run(onNewTurno)}
          />
          <ActionTile
            icon={FileText}
            label="Presupuestar"
            onClick={() => run(onPresupuesto)}
          />
        </div>

        <PhoneSection title="Etiquetas">
          <ChatTagsBar
            layout="grid"
            className="px-4"
            conversationId={conversation.id}
            contactName={title}
            currentTags={conversation.clients?.tags ?? []}
            allTags={allTags}
            onChange={onTagsChange}
          />
        </PhoneSection>
      </SheetContent>
    </Sheet>
  );
}

/** Los botones grandes de la ficha, como "Audio" y "Video" en WhatsApp. */
function ActionTile({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--wa-search-bg)] text-[0.8125rem] font-medium active:opacity-70 hover:bg-[var(--wa-active)]"
    >
      <Icon
        className="size-[22px] text-[var(--wa-accent-strong)]"
        strokeWidth={1.75}
      />
      {label}
    </button>
  );
}
