"use client";

import { Plus, SmilePlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { sendReactionAction } from "./actions";
import { EmojiPanel } from "./emoji-picker";

const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export function ReactionPicker({
  conversationId,
  targetExternalId,
  alignRight,
}: {
  conversationId: string;
  targetExternalId: string;
  alignRight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** El "+" cambia las seis de siempre por el catálogo completo. */
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Cerrado vuelve a las rápidas: la próxima reacción arranca de cero.
    if (!next) setExpanded(false);
  }

  function react(emoji: string) {
    setOpen(false);
    setExpanded(false);
    startTransition(async () => {
      const result = await sendReactionAction({
        conversationId,
        targetExternalId,
        emoji,
      });
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 text-[var(--wa-icon)] opacity-0 transition-opacity group-hover:opacity-100",
            "data-[state=open]:opacity-100",
          )}
          aria-label="Reaccionar"
          disabled={isPending}
        >
          <SmilePlus className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={alignRight ? "end" : "start"}
        side="top"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          expanded
            ? "w-[min(21rem,calc(100vw-1.5rem))] p-0"
            : "w-auto p-1 flex gap-0.5",
        )}
      >
        {expanded ? (
          <EmojiPanel onSelect={react} />
        ) : (
          <>
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => react(emoji)}
                className="wa-emoji size-9 rounded-md hover:bg-muted text-xl leading-none transition-transform hover:scale-110"
              >
                {emoji}
              </button>
            ))}
            {/* Igual que en WhatsApp: el "+" abre el resto del teclado de
                emojis sin sacar de encima el mensaje que se está reaccionando. */}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="Más emojis"
              title="Más emojis"
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-4" />
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline pill that shows reactions accumulated on a message. Each reactor
 * appears as one badge; counting is left to a parent component (we receive
 * a pre-aggregated list of emoji → count).
 */
export function ReactionsPill({
  counts,
  className,
}: {
  counts: Record<string, number>;
  className?: string;
}) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-[var(--wa-divider)] bg-[var(--wa-panel)] px-1.5 py-0.5 text-xs shadow-[var(--wa-bubble-shadow)]",
        className,
      )}
    >
      {entries.map(([emoji, count]) => (
        <span key={emoji} className="inline-flex items-center gap-0.5">
          <span className="text-sm leading-none">{emoji}</span>
          {count > 1 ? (
            <span className="tabular-nums text-muted-foreground text-[10px]">
              {count}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
