/* TEMPORAL — banco de pruebas visual del rediseño. Se borra al terminar. */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BrandWordmark } from "@/components/dashboard/brand-wordmark";
import {
  CalendarPlus,
  Check,
  CheckCheck,
  FileText,
  Hourglass,
  MessageCircle,
  MoreVertical,
  Search,
  Send,
  Paperclip,
  Wand2,
} from "lucide-react";

const CHATS = [
  { name: "Octavio", prev: "Documento", time: "Ayer", unread: 0, sel: true },
  { name: "Nico Maidana", prev: "cucha otra cosa caseros cobra premios tambi…", time: "Ayer", unread: 26, sel: false },
  { name: "Lucas 🐬", prev: "Me dijo que te lo dijo el día de la reunión cuan…", time: "Ayer", unread: 64, sel: false },
  { name: "Marina", prev: "Otro de los fallos que me saltó hoy es que cua…", time: "Ayer", unread: 4, sel: false },
  { name: "Zenna Hair Salón", prev: "Audio", time: "Ayer", unread: 30, sel: false },
];

export default function PreviewPage() {
  return (
    <div className="min-h-dvh bg-background p-6 space-y-8">
      <section className="space-y-4">
        <BrandWordmark size="lg" />
        <h1 className="font-display text-3xl">Títulos en Sora</h1>
        <p className="font-editorial text-2xl">Editorial en Cormorant Garamond</p>
        <p className="max-w-prose text-muted-foreground">
          Texto corrido en Inter. Números tabulares en{" "}
          <span className="font-mono tabular-nums">1.234.567</span> JetBrains Mono.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Nuevo turno</Button>
          <Button variant="outline">Fecha</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Eliminar</Button>
          <Badge>Badge</Badge>
          <Badge variant="outline">Outline</Badge>
          <span className="kbd">N</span>
          <div className="segmented">
            <span className="segmented-item" data-active="true">Día</span>
            <span className="segmented-item">Semana</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {["background", "card", "primary", "secondary", "muted", "accent", "destructive", "border"].map((t) => (
            <div key={t} className="text-center text-[11px]">
              <div className="size-16 rounded-lg border" style={{ background: `var(--${t})` }} />
              {t}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {["amber-400", "champagne-500", "mocha-800", "emerald-500", "red-500", "stone-400", "sky-500", "violet-500"].map((t) => (
            <div key={t} className="text-center text-[11px]">
              <div className="size-16 rounded-lg border" style={{ background: `var(--color-${t})` }} />
              {t}
            </div>
          ))}
        </div>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Tarjeta</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="section-label">Tipo de servicio</p>
              <Input placeholder="Escribí algo…" />
              <p className="text-sm text-muted-foreground">Borde hairline, sin sombra.</p>
            </CardContent>
          </Card>
          <div className="rounded-2xl border bg-sidebar p-4">
            <p className="section-label mb-3">Rail</p>
            <div className="flex gap-2">
              <span className="rail-item" data-active="true"><MessageCircle className="size-[18px]" strokeWidth={1.75} /></span>
              <span className="rail-item"><CalendarPlus className="size-[18px]" strokeWidth={1.75} /></span>
              <span className="rail-item"><FileText className="size-[18px]" strokeWidth={1.75} /></span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Réplica de la bandeja, con las mismas clases que crm-view ── */}
      <section className="h-[620px] overflow-hidden rounded-2xl border">
        <div className="wa-scope grid h-full min-h-0 grid-cols-[400px_1fr] bg-[var(--wa-app)] text-[var(--wa-text)]">
          <aside className="flex flex-col overflow-hidden border-r border-[var(--wa-border)] bg-[var(--wa-panel)]">
            <div className="flex h-[var(--wa-header-h)] shrink-0 items-center gap-3 bg-[var(--wa-panel-header)] px-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--wa-avatar-bg)] text-[var(--wa-icon)]">
                <MessageCircle className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[1.0625rem] font-medium text-[var(--wa-text)]">WhatsApp</div>
                <div className="truncate text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">128 conversaciones</div>
              </div>
              <button className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]">
                <MoreVertical className="size-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="shrink-0 px-3 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--wa-text-3)]" />
                <input
                  readOnly
                  placeholder="Buscá un chat o un contacto"
                  className="h-9 w-full rounded-lg border border-transparent bg-[var(--wa-search-bg)] pl-11 pr-4 text-[0.8125rem] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)]"
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 px-3 pb-2">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--wa-bubble-out)] px-3 text-[0.8125rem] text-[var(--wa-accent-strong)]">Todos</span>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--wa-search-bg)] px-3 text-[0.8125rem] text-[var(--wa-text-2)]">No leídos 94</span>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--wa-search-bg)] px-3 text-[0.8125rem] text-[var(--wa-text-2)]"><Hourglass className="size-3" />Esperando 3</span>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--wa-search-bg)] px-3 text-[0.8125rem] text-[var(--wa-text-2)]">Respondidos</span>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {CHATS.map((c) => (
                <li key={c.name}>
                  <div className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${c.sel ? "wa-row-active" : ""}`}>
                    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--wa-avatar-bg)] text-xs text-[var(--wa-avatar-fg)]">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 border-b border-[var(--wa-divider)] pb-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[0.9375rem] text-[var(--wa-text)] ${c.unread ? "font-semibold" : "font-normal"}`}>{c.name}</span>
                        <span className={`shrink-0 text-[0.6875rem] tabular-nums ${c.unread ? "font-medium text-[var(--wa-accent-strong)]" : "text-[var(--wa-text-2)]"}`}>{c.time}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[0.8125rem] text-[var(--wa-text-2)]">{c.prev}</span>
                        {c.unread ? (
                          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--wa-badge)] px-1.5 text-[0.6875rem] font-medium tabular-nums text-[var(--wa-badge-text)]">{c.unread}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <section className="relative flex flex-col overflow-hidden bg-[var(--wa-panel-header)]">
            <span aria-hidden className="h-1 shrink-0 bg-[var(--wa-accent)]" />
            <div className="flex h-[var(--wa-header-h)] shrink-0 items-center gap-3 border-b border-[var(--wa-divider)] bg-[var(--wa-panel-header)] px-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--wa-avatar-bg)] text-xs text-[var(--wa-avatar-fg)]">OC</span>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[1rem] text-[var(--wa-text)]">Octavio</span>
                <span className="truncate text-[0.8125rem] tabular-nums text-[var(--wa-text-2)]">+54 9 35 1696-1553</span>
              </div>
              <button className="flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]">
                <CalendarPlus className="size-5" strokeWidth={1.75} />
                <span className="hidden text-[0.8125rem] lg:inline">Nuevo turno</span>
              </button>
              <button className="flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]">
                <FileText className="size-5" strokeWidth={1.75} />
                <span className="hidden text-[0.8125rem] lg:inline">Presupuestar</span>
              </button>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--wa-divider)] bg-[var(--wa-panel-header)] px-4 py-2">
              <span className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-2 text-xs text-[var(--wa-text)]" style={{ borderColor: "#c49c76" }}>
                <span className="size-1.5 rounded-full" style={{ background: "#c49c76" }} />
                VIP
              </span>
              <span className="text-xs text-[var(--wa-text-2)]">Etiquetar</span>
            </div>

            <div className="wa-conv-bg flex min-h-0 flex-1 flex-col">
              <div className="wa-conv-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-4 py-4 sm:px-8">
                <div className="my-3 flex justify-center">
                  <span className="rounded-lg bg-[var(--wa-system-bubble)] px-3 py-1 text-[0.75rem] text-[var(--wa-system-text)] shadow-[var(--wa-bubble-shadow)]">
                    Sábado, 25 de julio
                  </span>
                </div>
                <div className="group flex items-end justify-start gap-1.5">
                  <div className="wa-tail-in relative max-w-[78%] rounded-lg rounded-tl-none bg-[var(--wa-bubble-in)] px-2 py-1.5 text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)]">
                    <div className="whitespace-pre-wrap break-words text-sm">Amigo, este micro es increíble para voces y no es taaaan caro</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[var(--wa-meta)]">
                      <span className="text-[0.6875rem] tabular-nums">22:07</span>
                    </div>
                  </div>
                </div>
                <div className="group flex items-end justify-start gap-1.5">
                  <div className="relative max-w-[78%] rounded-lg bg-[var(--wa-bubble-in)] px-2 py-1.5 text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)]">
                    <div className="whitespace-pre-wrap break-words text-sm">Segundo mensaje seguido — sin piquito, como WhatsApp.</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[var(--wa-meta)]">
                      <span className="text-[0.6875rem] tabular-nums">22:08</span>
                    </div>
                  </div>
                </div>
                <div className="group flex items-end justify-end gap-1.5">
                  <div className="wa-tail-out relative max-w-[78%] rounded-lg rounded-tr-none bg-[var(--wa-bubble-out)] px-2 py-1.5 text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)]">
                    <div className="whitespace-pre-wrap break-words text-sm">Bájame lo porfaa</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[var(--wa-meta)]">
                      <span className="text-[0.6875rem] tabular-nums">19:18</span>
                      <CheckCheck className="size-3 text-[var(--wa-tick-read)]" />
                    </div>
                  </div>
                </div>
                <div className="group flex items-end justify-end gap-1.5">
                  <div className="relative max-w-[78%] rounded-lg bg-[var(--wa-bubble-out)] px-2 py-1.5 text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)]">
                    <div className="whitespace-pre-wrap break-words text-sm">Dale, te paso el link en un rato 👍</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[var(--wa-meta)]">
                      <span className="text-[0.6875rem] tabular-nums">19:19</span>
                      <Check className="size-3 text-[var(--wa-tick)]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <form className="wa-composer flex shrink-0 items-center gap-1.5 bg-[var(--wa-composer)] p-2 sm:gap-2 sm:px-4">
              <Button type="button" variant="ghost" size="icon"><Paperclip className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon"><Wand2 className="size-4" /></Button>
              <Input readOnly placeholder="Escribí un mensaje" className="min-w-0 flex-1 border-transparent bg-[var(--wa-composer-field)] text-[var(--wa-text)] placeholder:text-[var(--wa-text-2)]" />
              <Button type="button" size="icon" className="shrink-0 rounded-full bg-[var(--wa-accent)] text-white hover:bg-[var(--wa-accent-strong)]">
                <Send className="size-4" />
              </Button>
            </form>
          </section>
        </div>
      </section>
    </div>
  );
}
