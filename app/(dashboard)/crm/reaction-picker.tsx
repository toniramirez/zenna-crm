"use client";

import { SmilePlus } from "lucide-react";
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
  const [isPending, startTransition] = useTransition();

  function react(emoji: string) {
    setOpen(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 opacity-0 group-hover:opacity-100 transition-opacity",
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
        className="w-auto p-1 flex gap-0.5"
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => react(emoji)}
            className="size-9 rounded-md hover:bg-muted text-xl leading-none transition-transform hover:scale-110"
          >
            {emoji}
          </button>
        ))}
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
        "inline-flex items-center gap-0.5 rounded-full bg-card border px-1.5 py-0.5 text-xs shadow-xs",
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
