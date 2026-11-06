"use client";

import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import {
  Ban,
  CalendarClock,
  Copy,
  LayoutTemplate,
  Megaphone,
  MessageSquareText,
  MoonStar,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isWithinSendWindow,
  SEND_WINDOW_LABEL,
} from "@/lib/automations/quiet-hours";
import {
  broadcastFiltersOf,
  describeCondition,
  describeExclusions,
} from "@/lib/broadcasts/filters";
import type {
  BroadcastStats,
  BroadcastStatus,
  BroadcastWithStats,
} from "@/lib/broadcasts/types";
import { ZENNA_TZ } from "@/lib/dates";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { cn } from "@/lib/utils";
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import {
  cancelBroadcastAction,
  deleteBroadcastAction,
  duplicateBroadcastAction,
  listBroadcastsAction,
} from "./broadcast-actions";
import { BroadcastDialog } from "./broadcast-dialog";
import { BroadcastRecipientsDialog } from "./broadcast-recipients-dialog";
import type { ClientTag, ProfessionalSlim, ServiceSlim } from "./config-types";

/** Cada cuánto se refrescan los números mientras hay una saliendo. */
const POLL_MS = 5_000;

const STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  completed: "Enviada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<BroadcastStatus, string> = {
  draft: "border-border text-muted-foreground",
  scheduled: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  sending: "border-gold/50 bg-gold/10 text-gold",
  completed:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "border-destructive/40 bg-destructive/10 text-destructive",
};

function statusOf(b: BroadcastWithStats): BroadcastStatus {
  return (STATUS_LABEL as Record<string, string>)[b.status]
    ? (b.status as BroadcastStatus)
    : "draft";
}

function when(iso: string): string {
  return formatInTimeZone(new Date(iso), ZENNA_TZ, "EEE d MMM, HH:mm", {
    locale: es,
  });
}

/**
 * CRM → Configuración → Difusiones.
 *
 * La lista arranca con lo que trajo la página y, mientras alguna difusión
 * está programada o saliendo, se refresca sola con una server action liviana
 * (solo difusiones y números) en vez de `router.refresh()`, que volvería a
 * traer toda la bandeja.
 */
export function BroadcastsManager({
  broadcasts: initial,
  tags,
  services,
  professionals,
  waTemplates,
}: {
  broadcasts: BroadcastWithStats[];
  tags: ClientTag[];
  services: ServiceSlim[];
  professionals: ProfessionalSlim[];
  waTemplates: WhatsappTemplateRow[];
}) {
  const [broadcasts, setBroadcasts] = useState(initial);
  const [editing, setEditing] = useState<BroadcastWithStats | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Cambia en cada apertura del editor: el diálogo se monta de cero y arranca
  // con el formulario de la difusión elegida, sin efectos que lo reseteen.
  const [dialogKey, setDialogKey] = useState(0);
  // Abierto y "de cuál" van separados: al cerrar, el diálogo conserva la
  // difusión mientras termina la animación en vez de vaciarse.
  const [recipientsOf, setRecipientsOf] = useState<BroadcastWithStats | null>(
    null,
  );
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [recipientsKey, setRecipientsKey] = useState(0);
  const [, startTransition] = useTransition();

  // Lo que mande la página después de una acción (revalidatePath) gana. Se
  // ajusta durante el render, que es como React recomienda derivar estado de
  // una prop que cambia (un efecto pintaría primero la lista vieja).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setBroadcasts(initial);
  }

  async function refresh() {
    const result = await listBroadcastsAction();
    if (result.broadcasts) setBroadcasts(result.broadcasts);
  }

  const live = broadcasts.some(
    (b) => b.status === "scheduled" || b.status === "sending",
  );
  useVisiblePoll(refresh, POLL_MS, live);

  const lookups = useMemo(() => {
    const serviceById = new Map(services.map((s) => [s.id, s.name]));
    const professionalById = new Map(
      professionals.map((p) => [p.id, p.full_name]),
    );
    return {
      serviceName: (id: string) => serviceById.get(id),
      professionalName: (id: string) => professionalById.get(id),
    };
  }, [services, professionals]);

  function openCreate() {
    setEditing(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function openEdit(b: BroadcastWithStats) {
    setEditing(b);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function run(
    action: () => Promise<{ error?: string; success?: boolean }>,
    ok: string | ((r: { outcome?: string }) => string),
  ) {
    startTransition(async () => {
      const result = (await action()) as {
        error?: string;
        success?: boolean;
        outcome?: string;
      };
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(typeof ok === "string" ? ok : ok(result));
      await refresh();
    });
  }

  function handleCancel(b: BroadcastWithStats) {
    const question =
      b.status === "scheduled"
        ? `¿Desprogramar "${b.name}"? Queda como borrador.`
        : `¿Cancelar el envío de "${b.name}"? Lo que ya salió no se puede borrar; al resto no le llega.`;
    if (!confirm(question)) return;
    run(
      () => cancelBroadcastAction(b.id),
      (r) =>
        r.outcome === "draft"
          ? "Se desprogramó. Quedó como borrador."
          : "Envío cancelado.",
    );
  }

  function handleDelete(b: BroadcastWithStats) {
    const question =
      b.stats.total > 0
        ? `¿Borrar "${b.name}"? Se pierde el resumen; los mensajes que salieron siguen en cada chat.`
        : `¿Borrar "${b.name}"?`;
    if (!confirm(question)) return;
    run(() => deleteBroadcastAction(b.id), "Difusión borrada.");
  }

  function handleDuplicate(b: BroadcastWithStats) {
    run(
      () => duplicateBroadcastAction(b.id),
      "Se creó una copia en borrador.",
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Un mismo mensaje por WhatsApp a un grupo de clientas: las que tienen
          cierta etiqueta, las que no vienen hace dos meses, las que cumplen
          años este mes… Combinás los filtros, ves a cuántas les llega y lo
          mandás ahora o lo programás. Sale {SEND_WINDOW_LABEL}, de a poco.
        </p>
        <Button onClick={openCreate} size="sm" className="shrink-0">
          <Plus className="size-4" />
          Nueva difusión
        </Button>
      </div>

      {broadcasts.length === 0 ? (
        <div className="space-y-2 rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          <Megaphone className="mx-auto size-5 text-gold" />
          <p>Todavía no armaste ninguna difusión.</p>
          <p className="text-xs">
            Ejemplo: &quot;Te extrañamos&quot; — a las que no vienen hace más
            de 60 días y no tienen turno agendado.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {broadcasts.map((b) => (
            <BroadcastCard
              key={b.id}
              broadcast={b}
              lookups={lookups}
              onEdit={() => openEdit(b)}
              onRecipients={() => {
                setRecipientsOf(b);
                setRecipientsKey((k) => k + 1);
                setRecipientsOpen(true);
              }}
              onDuplicate={() => handleDuplicate(b)}
              onCancel={() => handleCancel(b)}
              onDelete={() => handleDelete(b)}
            />
          ))}
        </div>
      )}

      <BroadcastDialog
        key={`editor-${dialogKey}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        broadcast={editing}
        tags={tags}
        services={services}
        professionals={professionals}
        waTemplates={waTemplates}
        onSaved={() => void refresh()}
      />

      <BroadcastRecipientsDialog
        key={`recipients-${recipientsKey}`}
        open={recipientsOpen}
        onOpenChange={setRecipientsOpen}
        broadcastId={recipientsOf?.id ?? null}
        broadcastName={recipientsOf?.name ?? ""}
      />
    </div>
  );
}

function BroadcastCard({
  broadcast: b,
  lookups,
  onEdit,
  onRecipients,
  onDuplicate,
  onCancel,
  onDelete,
}: {
  broadcast: BroadcastWithStats;
  lookups: Parameters<typeof describeCondition>[1];
  onEdit: () => void;
  onRecipients: () => void;
  onDuplicate: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const status = statusOf(b);
  const filters = broadcastFiltersOf(b.filters);
  const conditions = filters.conditions.map((c) => describeCondition(c, lookups));
  const exclusions = describeExclusions(filters);
  const editable = status === "draft" || status === "scheduled";
  const paused = status === "sending" && !isWithinSendWindow(new Date());

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-xl border bg-card p-4",
        status === "cancelled" && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{b.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {timeline(b, status)}
          </div>
        </div>
        <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[status])}>
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3" />
          {conditions.length === 0
            ? "Todas las clientas con teléfono"
            : filters.match === "all" || conditions.length === 1
              ? "Clientas que cumplen:"
              : "Clientas que cumplen alguna:"}
        </div>
        {conditions.length + exclusions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {conditions.map((text, i) => (
              <Badge key={`c-${i}`} variant="outline" className="text-[10px] font-normal">
                {text}
              </Badge>
            ))}
            {exclusions.map((text, i) => (
              <Badge
                key={`e-${i}`}
                variant="outline"
                className="border-dashed text-[10px] font-normal text-muted-foreground"
              >
                {text}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-1.5 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
        {b.send_mode === "template" ? (
          <>
            <LayoutTemplate className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span>
              Plantilla{" "}
              <strong className="font-medium">{b.template_name ?? "?"}</strong>{" "}
              <span className="text-muted-foreground">
                ({b.template_language ?? "?"})
              </span>
            </span>
          </>
        ) : (
          <>
            <MessageSquareText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span className="line-clamp-2 whitespace-pre-wrap">{b.message_body}</span>
          </>
        )}
      </div>

      {b.stats.total > 0 ? <StatsBlock stats={b.stats} /> : null}

      {paused ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MoonStar className="size-3.5" />
          En pausa fuera de horario: sigue a las 9.
        </p>
      ) : null}

      {b.last_error ? (
        <p className="text-xs text-destructive">{b.last_error}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-1">
        {b.audience_size !== null ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRecipients}>
            <Users className="size-3.5" />
            Destinatarias
          </Button>
        ) : null}
        {editable ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDuplicate}
          title="Duplicar"
          aria-label="Duplicar"
        >
          <Copy className="size-3.5" />
        </Button>
        {status === "scheduled" || status === "sending" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onCancel}
          >
            {status === "scheduled" ? (
              <CalendarClock className="size-3.5" />
            ) : (
              <Ban className="size-3.5" />
            )}
            {status === "scheduled" ? "Desprogramar" : "Cancelar envío"}
          </Button>
        ) : null}
        {status !== "sending" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            title="Borrar"
            aria-label="Borrar"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function timeline(b: BroadcastWithStats, status: BroadcastStatus): string {
  switch (status) {
    case "draft":
      return `Creada el ${when(b.created_at)}`;
    case "scheduled":
      return b.scheduled_for
        ? new Date(b.scheduled_for).getTime() <= Date.now()
          ? "Arranca en unos segundos"
          : `Sale el ${when(b.scheduled_for)}`
        : "Programada";
    case "sending": {
      const done = b.stats.total - b.stats.pending;
      return b.audience_size === null
        ? "Armando la lista de destinatarias…"
        : `${done} de ${b.stats.total} procesadas`;
    }
    case "completed":
      return `Enviada el ${when(b.started_at ?? b.completed_at ?? b.created_at)}`;
    case "cancelled":
      return `Cancelada el ${when(b.cancelled_at ?? b.updated_at)}`;
  }
}

/**
 * La barra apilada y los números. Las categorías son las de la vista
 * `broadcast_stats`, que son excluyentes: los segmentos de la barra suman el
 * total. "Respondieron" va aparte porque se superpone con entregado/leído.
 */
function StatsBlock({ stats }: { stats: BroadcastStats }) {
  const segments: { value: number; className: string; label: string }[] = [
    { value: stats.read, className: "bg-sky-500", label: "Leídos" },
    { value: stats.delivered, className: "bg-emerald-500", label: "Entregados" },
    { value: stats.sent, className: "bg-foreground/40", label: "Enviados" },
    {
      value: stats.inQueue + stats.pending,
      className: "bg-muted-foreground/20",
      label: "Por salir",
    },
    { value: stats.failed, className: "bg-destructive", label: "Fallidos" },
    { value: stats.skipped, className: "bg-amber-500", label: "Omitidos" },
  ];

  // "Entregados" cuenta también a las que ya lo leyeron: es lo que se espera
  // leer en la tarjeta ("le llegó a 300, lo leyeron 120").
  const reached = stats.delivered + stats.read;

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={s.className}
              style={{ width: `${(s.value / stats.total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-4 gap-1 text-center">
        <Stat label="Llegaron" value={reached} />
        <Stat label="Leyeron" value={stats.read} />
        <Stat label="Respondieron" value={stats.replied} />
        <Stat
          label="No llegaron"
          value={stats.failed + stats.skipped}
          tone={stats.failed + stats.skipped > 0 ? "warn" : undefined}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-md bg-muted/30 px-1 py-1">
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "warn" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
