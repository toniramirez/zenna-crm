"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { setConversationTagsAction } from "./actions";
import type { ClientTag } from "./config-types";

const NEUTRAL_COLOR = "#94a3b8";

export type LinkedClient = {
  id: string;
  full_name: string;
  phone: string | null;
};

/**
 * Tag bar shown above the chat thread. Works even when the conversation
 * isn't linked to a clienta yet — the first tag click auto-creates one
 * using the WhatsApp display name + phone and links the conversation.
 *
 * Tag names that exist on the client but aren't in the master list still
 * render — with a neutral color and no metadata — so legacy free-text tags
 * stay visible without a migration.
 */
export function ChatTagsBar({
  conversationId,
  currentTags,
  contactName,
  allTags,
  onChange,
}: {
  conversationId: string;
  currentTags: string[];
  contactName: string;
  allTags: ClientTag[];
  onChange?: (next: string[], linkedClient: LinkedClient) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [tags, setTags] = useState(currentTags);

  useEffect(() => {
    setTags(currentTags);
  }, [conversationId, currentTags]);

  function commit(next: string[]) {
    const previous = tags;
    setTags(next);
    startTransition(async () => {
      const result = await setConversationTagsAction(conversationId, next);
      if (result.error || !result.client) {
        toast.error(result.error ?? "No pudimos actualizar las etiquetas.");
        setTags(previous);
        return;
      }
      onChange?.(next, result.client);
    });
  }

  function toggle(name: string) {
    const has = tags.includes(name);
    commit(has ? tags.filter((t) => t !== name) : [...tags, name]);
  }

  function remove(name: string) {
    commit(tags.filter((t) => t !== name));
  }

  const byName = useMemo(() => {
    const map = new Map<string, ClientTag>();
    for (const t of allTags) map.set(t.name, t);
    return map;
  }, [allTags]);

  const activeMasterTags = useMemo(
    () => allTags.filter((t) => t.active),
    [allTags],
  );

  const firstName = contactName.split(" ")[0] || contactName;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b bg-card/60">
      {tags.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Sin etiquetas para {firstName}
        </span>
      ) : (
        tags.map((name) => {
          const meta = byName.get(name);
          const color = meta?.color ?? NEUTRAL_COLOR;
          return (
            <span
              key={name}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border pl-2 pr-0.5 py-0.5 text-xs",
                isPending && "opacity-70",
              )}
              style={{ borderColor: color }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium">{name}</span>
              <button
                type="button"
                onClick={() => remove(name)}
                disabled={isPending}
                className="size-4 inline-flex items-center justify-center rounded-full hover:bg-muted"
                aria-label={`Quitar ${name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={isPending}
          >
            <Plus className="size-3" />
            Etiquetar
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar etiqueta…" />
            <CommandList>
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                Sin etiquetas. Creá en Configuración → Etiquetas.
              </CommandEmpty>
              <CommandGroup>
                {activeMasterTags.map((t) => {
                  const checked = tags.includes(t.name);
                  return (
                    <CommandItem
                      key={t.id}
                      value={t.name}
                      onSelect={() => toggle(t.name)}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="flex-1 text-sm">{t.name}</span>
                      {checked ? (
                        <Check className="size-3.5 text-muted-foreground" />
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
