"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getIcon, type NavItem } from "./nav";

/**
 * Buscador del rail (la lupa, segundo ícono desde arriba). Salta entre
 * secciones. Se abre con ⌘K / Ctrl+K además del click.
 */
export function NavSearch({
  items,
  open,
  onOpenChange,
}: {
  items: NavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar"
      description="Buscá una sección de la app"
    >
      <CommandInput placeholder="Buscá una sección…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        <CommandGroup heading="Secciones">
          {items.map((item) => {
            const Icon = getIcon(item.iconName);
            return (
              <CommandItem
                key={item.href}
                value={item.label}
                onSelect={() => {
                  onOpenChange(false);
                  router.push(item.href);
                }}
              >
                <Icon strokeWidth={1.75} />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
