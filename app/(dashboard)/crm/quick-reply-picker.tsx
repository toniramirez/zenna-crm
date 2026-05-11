"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import type { QuickReply } from "./config-types";

export function QuickReplyPicker({
  replies,
  onSelect,
  disabled,
}: {
  replies: QuickReply[];
  onSelect: (body: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (replies.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Mensajes rápidos"
          title="Mensajes rápidos"
        >
          <Wand2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar por nombre o atajo…" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
              Sin resultados.
            </CommandEmpty>
            <CommandGroup>
              {replies.map((qr) => (
                <CommandItem
                  key={qr.id}
                  value={`${qr.label} ${qr.shortcut ?? ""} ${qr.body}`}
                  onSelect={() => {
                    onSelect(qr.body);
                    setOpen(false);
                  }}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium text-sm flex-1 truncate">
                      {qr.label}
                    </span>
                    {qr.shortcut ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono"
                      >
                        {qr.shortcut}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground line-clamp-2">
                    {qr.body}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
