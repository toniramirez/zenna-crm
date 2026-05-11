"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import {
  Check,
  Loader2,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  dismissSuggestionAction,
  generateOutreachSuggestionsAction,
  markSuggestionSentAction,
  updateSuggestionMessageAction,
} from "./outreach-actions";
import type { OutreachSuggestionWithRelations } from "./outreach-types";

/**
 * Strip everything that isn't a digit. wa.me expects a raw phone (e.g.
 * "5493510000000") — no plus sign, no spaces, no parentheses.
 */
function waPhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

function waLink(phone: string, message: string): string {
  return `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(message)}`;
}

export function OutreachManager({
  suggestions,
}: {
  suggestions: OutreachSuggestionWithRelations[];
}) {
  const [generating, startGenerating] = useTransition();

  const pending = suggestions.filter((s) => s.status === "pending");
  const recent = suggestions
    .filter((s) => s.status !== "pending")
    .slice(0, 10);

  function handleGenerate() {
    startGenerating(async () => {
      const result = await generateOutreachSuggestionsAction();
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success(
          `${result.inserted ?? 0} sugerencia${result.inserted === 1 ? "" : "s"} generada${result.inserted === 1 ? "" : "s"}.`,
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          La IA analiza el historial de clientas dormidas (sin visita hace
          21+ días) y arma mensajes personalizados ofreciendo un servicio
          compatible. Vos los revisás y, si te cuadra, tocás &quot;Abrir en
          WhatsApp&quot; — se abre el chat de la clienta con el texto listo
          para enviar.
        </p>
        <Button onClick={handleGenerate} disabled={generating} size="sm">
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Generar sugerencias
        </Button>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground space-y-2">
          <Sparkles className="size-5 mx-auto text-gold" />
          <p>No hay sugerencias pendientes.</p>
          <p className="text-xs">
            Tocá &quot;Generar sugerencias&quot; para que la IA arme una
            tanda nueva en base a quién no viene hace rato.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pendientes ({pending.length})
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {pending.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} />
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 ? (
        <div className="space-y-2 pt-4 border-t">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Historial reciente
          </div>
          <ul className="text-xs divide-y rounded-md border bg-card">
            {recent.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant={s.status === "sent" ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {s.status === "sent" ? "enviado" : "descartado"}
                  </Badge>
                  <span className="truncate">
                    {s.clients?.full_name ?? "Cliente eliminada"}
                    {s.services?.name ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.services.name}
                      </span>
                    ) : null}
                  </span>
                </div>
                <span className="text-muted-foreground shrink-0">
                  {formatDistanceToNowStrict(
                    new Date(s.sent_at ?? s.dismissed_at ?? s.generated_at),
                    { locale: es, addSuffix: true },
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionCard({
  suggestion,
}: {
  suggestion: OutreachSuggestionWithRelations;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion.message_body);

  const phone = suggestion.clients?.phone ?? null;
  const link = phone ? waLink(phone, suggestion.message_body) : null;

  function handleOpenWhatsApp() {
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    // Optimistic UX: assume the owner is about to send. Mark as sent so the
    // cooldown kicks in and this card disappears from the inbox.
    startTransition(async () => {
      const result = await markSuggestionSentAction(suggestion.id);
      if (result.error) toast.error(result.error);
    });
  }

  function handleDismiss() {
    if (!confirm("¿Descartar esta sugerencia?")) return;
    startTransition(async () => {
      const result = await dismissSuggestionAction(suggestion.id);
      if (result.error) toast.error(result.error);
      else toast.success("Sugerencia descartada.");
    });
  }

  function handleSaveEdit() {
    startTransition(async () => {
      const result = await updateSuggestionMessageAction(
        suggestion.id,
        draft,
      );
      if (result.error) toast.error(result.error);
      else {
        toast.success("Mensaje actualizado.");
        setEditing(false);
      }
    });
  }

  function handleCancelEdit() {
    setDraft(suggestion.message_body);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium truncate">
            {suggestion.clients?.full_name ?? "Cliente eliminada"}
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
            {suggestion.services?.name ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                {suggestion.services.name}
              </Badge>
            ) : null}
            {suggestion.clients?.last_visit_at ? (
              <span>
                última visita{" "}
                {formatDistanceToNowStrict(
                  new Date(suggestion.clients.last_visit_at),
                  { locale: es, addSuffix: true },
                )}
              </span>
            ) : null}
            {!phone ? (
              <span className="text-destructive">sin teléfono</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px] italic text-muted-foreground">
        {suggestion.reason}
      </div>

      {editing ? (
        <Textarea
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="text-sm"
          disabled={isPending}
        />
      ) : (
        <div className="rounded-md bg-muted/20 px-2.5 py-2 text-sm whitespace-pre-wrap">
          {suggestion.message_body}
        </div>
      )}

      <div className="flex items-center justify-end gap-1">
        {editing ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancelEdit}
              disabled={isPending}
            >
              <X className="size-3.5" />
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveEdit}
              disabled={isPending}
            >
              <Check className="size-3.5" />
              Guardar
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={isPending}
              title="Editar mensaje"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDismiss}
              disabled={isPending}
              title="Descartar"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleOpenWhatsApp}
              disabled={!link || isPending}
              title={
                link ? "Abrir chat en WhatsApp con el mensaje cargado" : ""
              }
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Abrir en WhatsApp
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
