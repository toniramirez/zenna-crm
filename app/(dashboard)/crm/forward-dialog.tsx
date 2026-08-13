"use client";

import { Forward, Loader2, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { forwardMessageAction } from "./actions";
import { ChatAvatar } from "./chat-avatar";
import type { ConversationWithClient, MessageRow } from "./types";

/** El mismo tope que WhatsApp: cinco chats por reenvío. */
const MAX_TARGETS = 5;

function previewOf(message: MessageRow): string {
  if (message.body?.trim()) return message.body.trim();
  switch (message.type) {
    case "image":
      return "📷 Imagen";
    case "video":
      return "🎥 Video";
    case "audio":
      return "🎤 Audio";
    case "document":
      return message.media_filename ?? "📄 Documento";
    case "sticker":
      return "🩷 Sticker";
    default:
      return "Mensaje";
  }
}

/**
 * "Reenviar a…". Lista de chats con buscador y hasta cinco destinos, como en
 * WhatsApp. El mensaje se encola una vez por chat elegido.
 */
export function ForwardDialog({
  message,
  conversations,
  currentConversationId,
  titleOf,
  onOpenChange,
}: {
  /** Mensaje a reenviar. `null` mantiene el diálogo cerrado. */
  message: MessageRow | null;
  conversations: ConversationWithClient[];
  currentConversationId: string | null;
  /** Cómo se llama cada chat en la lista (lo resuelve la bandeja). */
  titleOf: (conversation: ConversationWithClient) => string;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentConversationId)
      .filter((c) =>
        needle ? titleOf(c).toLowerCase().includes(needle) : true,
      )
      .slice(0, 60);
  }, [conversations, currentConversationId, query, titleOf]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TARGETS) {
        toast.error(`Podés reenviar a ${MAX_TARGETS} chats por vez.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function close() {
    setQuery("");
    setSelected([]);
    onOpenChange(false);
  }

  function submit() {
    if (!message || selected.length === 0) return;
    const targets = selected;
    startTransition(async () => {
      const result = await forwardMessageAction(message.id, targets);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        targets.length === 1
          ? "Mensaje reenviado."
          : `Mensaje reenviado a ${targets.length} chats.`,
      );
      close();
    });
  }

  return (
    <Dialog
      open={!!message}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reenviar mensaje</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {message ? previewOf(message) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscá un chat"
            aria-label="Buscá un chat"
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-72 -mx-2">
          {options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No hay otros chats que coincidan.
            </p>
          ) : (
            <ul className="px-2">
              {options.map((c) => {
                const checked = selected.includes(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      aria-pressed={checked}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                        checked ? "bg-accent" : "hover:bg-muted",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <ChatAvatar
                        name={titleOf(c)}
                        avatarPath={c.avatar_path}
                        channel={c.channel}
                        size={32}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {titleOf(c)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter className="sm:justify-between">
          <span className="hidden text-sm text-muted-foreground sm:block">
            {selected.length}/{MAX_TARGETS} elegidos
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={selected.length === 0 || isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Forward className="size-4" />
              )}
              Reenviar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
