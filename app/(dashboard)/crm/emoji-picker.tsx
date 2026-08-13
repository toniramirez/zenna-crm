"use client";

import { Search, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEFAULT_RECENTS, EMOJI_CATEGORIES } from "./emoji-data";

const RECENTS_KEY = "zenna:emoji-recents";
const RECENTS_MAX = 24;
/** Cuántos entran en la fila de "Recientes" sin hacerla scrollear. */
const RECENTS_SHOWN = 16;

/**
 * Búsqueda sin acentos: nadie escribe "limón" con tilde en el buscador, pero
 * las palabras del catálogo sí las tienen porque también se leen.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is string => typeof e === "string");
  } catch {
    // Modo incógnito, storage lleno o un valor viejo con otro formato: los
    // recientes son una comodidad, no vale romper el selector por esto.
    return [];
  }
}

function writeRecents(emojis: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(emojis));
  } catch {
    /* idem */
  }
}

/**
 * La grilla en sí. Va aparte del popover porque se usa desde dos lugares: el
 * botón de la barra de escritura y el "+" del menú de reacciones, que la abre
 * dentro de su propio popover (uno anidado se pelearía con el foco del otro).
 */
export function EmojiPanel({
  onSelect,
  className,
}: {
  onSelect: (emoji: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  // El historial se lee al montar y no en un efecto: este panel vive dentro de
  // un popover, que se monta recién cuando alguien lo abre y siempre en el
  // cliente. La guarda de `window` es por si alguna vez se usa server-side.
  const [picked, setPicked] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readRecents(),
  );
  const [activeCategory, setActiveCategory] = useState<string>("recientes");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionsRef = useRef<Record<string, HTMLDivElement | null>>({});

  // El foco al buscador solo en escritorio: en el celular levantaría el
  // teclado justo encima de la grilla que se acaba de abrir.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    searchRef.current?.focus();
  }, []);

  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const emoji of [...picked, ...DEFAULT_RECENTS]) {
      if (seen.has(emoji)) continue;
      seen.add(emoji);
      out.push(emoji);
      if (out.length === RECENTS_SHOWN) break;
    }
    return out;
  }, [picked]);

  const results = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const category of EMOJI_CATEGORIES) {
      for (const [emoji, keywords] of category.emojis) {
        if (seen.has(emoji)) continue;
        if (!normalize(keywords).includes(needle)) continue;
        seen.add(emoji);
        out.push(emoji);
      }
    }
    return out;
  }, [query]);

  function pick(emoji: string) {
    setPicked((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(
        0,
        RECENTS_MAX,
      );
      writeRecents(next);
      return next;
    });
    onSelect(emoji);
  }

  function goToCategory(id: string) {
    const container = scrollRef.current;
    const section = sectionsRef.current[id];
    if (!container || !section) return;
    // `scrollIntoView` acá arrastraría también la página de atrás; el offset
    // dentro del contenedor alcanza y no toca nada más.
    container.scrollTop = section.offsetTop;
    setActiveCategory(id);
  }

  // Marca en la barra de abajo la categoría que se está mirando.
  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const top = container.scrollTop + 8;
    let current = "recientes";
    for (const category of EMOJI_CATEGORIES) {
      const section = sectionsRef.current[category.id];
      if (section && section.offsetTop <= top) current = category.id;
    }
    setActiveCategory(current);
  }

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <div className="relative px-2 pt-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar emoji"
          aria-label="Buscar emoji"
          autoComplete="off"
          className="h-8 w-full rounded-md bg-muted pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={results ? undefined : handleScroll}
        className="relative h-56 overflow-y-auto overscroll-contain px-2 py-2"
      >
        {results ? (
          results.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ningún emoji para “{query.trim()}”.
            </p>
          ) : (
            <EmojiGrid emojis={results} onPick={pick} />
          )
        ) : (
          <>
            <EmojiSection title="Recientes" emojis={recents} onPick={pick} />
            {EMOJI_CATEGORIES.map((category) => (
              <div
                key={category.id}
                ref={(el) => {
                  sectionsRef.current[category.id] = el;
                }}
              >
                <EmojiSection
                  title={category.label}
                  emojis={category.emojis.map(([emoji]) => emoji)}
                  onPick={pick}
                />
              </div>
            ))}
          </>
        )}
      </div>

      {results ? null : (
        <div className="flex items-center justify-between border-t px-1.5 py-1">
          {EMOJI_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => goToCategory(category.id)}
              title={category.label}
              aria-label={category.label}
              className={cn(
                "wa-emoji flex size-7 items-center justify-center rounded-md text-base opacity-60 transition hover:bg-muted hover:opacity-100",
                activeCategory === category.id && "bg-muted opacity-100",
              )}
            >
              {category.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmojiSection({
  title,
  emojis,
  onPick,
}: {
  title: string;
  emojis: readonly string[];
  onPick: (emoji: string) => void;
}) {
  if (emojis.length === 0) return null;
  return (
    <>
      <div className="sticky top-0 z-10 bg-popover py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <EmojiGrid emojis={emojis} onPick={onPick} />
    </>
  );
}

function EmojiGrid({
  emojis,
  onPick,
}: {
  emojis: readonly string[];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5 pb-2">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className="wa-emoji flex size-8 items-center justify-center rounded-md text-xl transition-transform hover:scale-110 hover:bg-muted"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * Botón + popover, para la barra de escritura.
 *
 * No se cierra al elegir: en un chat rara vez se manda un emoji solo, y volver
 * a abrirlo para el segundo es justo lo que WhatsApp evita dejando el panel
 * abierto hasta que uno lo cierra.
 */
export function EmojiPicker({
  onSelect,
  onOpenChange,
  disabled,
}: {
  onSelect: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Emojis"
          title="Emojis"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        // El popover se abre solo; robarle el foco al campo de escritura acá
        // levantaría el teclado del celular encima de la grilla.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[min(21rem,calc(100vw-1.5rem))] p-0"
      >
        {/* El contenido del popover se monta recién al abrirlo, así que la
            grilla no pesa en el árbol de cada chat cerrado. */}
        <EmojiPanel onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  );
}
