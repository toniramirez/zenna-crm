"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BroadcastRecipientView } from "@/lib/broadcasts/types";
import { cn } from "@/lib/utils";
import { broadcastRecipientsAction } from "./broadcast-actions";

/**
 * En qué quedó cada destinataria, en una sola palabra. Mientras el mensaje
 * no se encoló manda el estado de la cola de la difusión; después, el del
 * mensaje, que es el que actualizan los acuses de Meta.
 */
export type RecipientBucket =
  | "pending"
  | "in_queue"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

export function recipientBucket(r: BroadcastRecipientView): RecipientBucket {
  if (r.status === "pending" || r.status === "processing") return "pending";
  if (r.status === "skipped") return "skipped";
  if (r.status === "failed") return "failed";
  switch (r.messageStatus) {
    case "failed":
      return "failed";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    default:
      return "in_queue";
  }
}

export const BUCKET_LABEL: Record<RecipientBucket, string> = {
  pending: "Esperando",
  in_queue: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
  skipped: "Omitido",
};

export const BUCKET_TONE: Record<RecipientBucket, string> = {
  pending: "bg-muted text-muted-foreground",
  in_queue: "bg-muted text-muted-foreground",
  sent: "bg-muted text-foreground",
  delivered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  read: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const FILTER_ORDER: RecipientBucket[] = [
  "read",
  "delivered",
  "sent",
  "in_queue",
  "pending",
  "failed",
  "skipped",
];

export function BroadcastRecipientsDialog({
  open,
  onOpenChange,
  broadcastId,
  broadcastName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broadcastId: string | null;
  broadcastName: string;
}) {
  // El panel le cambia la `key` a este diálogo por difusión, así que cada
  // apertura monta de cero: arranca cargando y con el filtro en "Todas".
  const [loaded, setLoaded] = useState<{
    rows: BroadcastRecipientView[];
    truncated: boolean;
    error: string | null;
  } | null>(null);
  const [filter, setFilter] = useState<RecipientBucket | "all">("all");

  useEffect(() => {
    if (!open || !broadcastId) return;
    let alive = true;
    void broadcastRecipientsAction(broadcastId).then((result) => {
      if (!alive) return;
      setLoaded({
        rows: result.recipients ?? [],
        truncated: Boolean(result.truncated),
        error: result.error ?? null,
      });
    });
    return () => {
      alive = false;
    };
  }, [open, broadcastId]);

  const loading = loaded === null;
  const error = loaded?.error ?? null;
  const rows = useMemo(() => loaded?.rows ?? [], [loaded]);
  const truncated = loaded?.truncated ?? false;

  const withBucket = useMemo(
    () => rows.map((r) => ({ ...r, bucket: recipientBucket(r) })),
    [rows],
  );

  const counts = useMemo(() => {
    const out = new Map<RecipientBucket, number>();
    for (const r of withBucket) out.set(r.bucket, (out.get(r.bucket) ?? 0) + 1);
    return out;
  }, [withBucket]);

  const visible =
    filter === "all" ? withBucket : withBucket.filter((r) => r.bucket === filter);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Destinatarias</DialogTitle>
          <DialogDescription>{broadcastName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Cargando…
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no se armó la lista: se calcula cuando arranca el envío.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <FilterButton
                active={filter === "all"}
                onClick={() => setFilter("all")}
              >
                Todas · {rows.length}
              </FilterButton>
              {FILTER_ORDER.filter((b) => counts.get(b)).map((b) => (
                <FilterButton
                  key={b}
                  active={filter === b}
                  onClick={() => setFilter(b)}
                >
                  {BUCKET_LABEL[b]} · {counts.get(b)}
                </FilterButton>
              ))}
            </div>

            <ul className="-mx-6 min-h-0 flex-1 divide-y overflow-y-auto border-y px-6">
              {visible.map((r) => {
                const reason =
                  r.bucket === "failed"
                    ? (r.messageError ?? r.error)
                    : r.bucket === "skipped"
                      ? r.error
                      : null;
                return (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.fullName}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        +{r.phone}
                      </p>
                      {reason ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {reason}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        BUCKET_TONE[r.bucket],
                      )}
                    >
                      {BUCKET_LABEL[r.bucket]}
                    </span>
                    {r.conversationId ? (
                      // <a> y no <Link>: /crm es la misma ruta, y una
                      // navegación del cliente conservaría la pestaña de
                      // configuración abierta en vez de ir al chat.
                      <a
                        href={`/crm?c=${r.conversationId}`}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Abrir el chat"
                        aria-label={`Abrir el chat de ${r.fullName}`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {truncated ? (
              <p className="text-[11px] text-muted-foreground">
                Se muestran las primeras {rows.length}. Los números de la
                tarjeta cuentan a todas.
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors",
        active
          ? "border-gold bg-gold/10 text-foreground"
          : "bg-background text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}
