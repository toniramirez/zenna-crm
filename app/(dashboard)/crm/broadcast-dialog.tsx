"use client";

import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Save,
  Send,
  Users,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isWithinSendWindow,
  SEND_WINDOW_LABEL,
} from "@/lib/automations/quiet-hours";
import { templateParamsOf } from "@/lib/automations/message";
import {
  broadcastFiltersSchema,
  type BroadcastFilters,
  EMPTY_BROADCAST_FILTERS,
  readBroadcastFilters,
} from "@/lib/broadcasts/filters";
import type { BroadcastWithStats } from "@/lib/broadcasts/types";
import { ZENNA_TZ } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  BROADCAST_VARIABLES,
  type BroadcastInput,
  broadcastSchema,
  type BroadcastSchedule,
} from "@/lib/validations/broadcasts";
import {
  type AutomationSendMode,
  type TemplateParamsInput,
} from "@/lib/validations/crm-config";
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import {
  type AudiencePreview,
  previewBroadcastAudienceAction,
  saveBroadcastAction,
} from "./broadcast-actions";
import { BroadcastFiltersEditor } from "./broadcast-filters-editor";
import type { ClientTag, ProfessionalSlim, ServiceSlim } from "./config-types";
import { FlowTemplateFields } from "./flow-template-fields";

/** Espera desde el último cambio de filtro hasta recalcular el segmento. */
const PREVIEW_DEBOUNCE_MS = 450;

type WhenKind = "now" | "at";

/** "2026-11-10T10:00": la próxima hora en punto, en hora del salón. */
function nextRoundHour(now: Date): string {
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  return formatInTimeZone(next, ZENNA_TZ, "yyyy-MM-dd'T'HH:00");
}

function localInputValue(iso: string): string {
  return formatInTimeZone(new Date(iso), ZENNA_TZ, "yyyy-MM-dd'T'HH:mm");
}

type Draft = {
  name: string;
  filters: BroadcastFilters;
  sendMode: AutomationSendMode;
  messageBody: string;
  templateName: string;
  templateLanguage: string;
  templateParams: TemplateParamsInput;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  filters: EMPTY_BROADCAST_FILTERS,
  // Plantilla por defecto: es lo único que le llega a una clienta que no
  // escribió en las últimas 24 h, o sea a casi todo el segmento.
  sendMode: "template",
  messageBody: "",
  templateName: "",
  templateLanguage: "",
  templateParams: { header: {}, body: {} },
};

function draftOf(b: BroadcastWithStats, filters: BroadcastFilters): Draft {
  return {
    name: b.name,
    filters,
    sendMode: b.send_mode === "text" ? "text" : "template",
    messageBody: b.message_body,
    templateName: b.template_name ?? "",
    templateLanguage: b.template_language ?? "",
    templateParams: templateParamsOf(b.template_params),
  };
}

export function BroadcastDialog({
  open,
  onOpenChange,
  broadcast,
  tags,
  services,
  professionals,
  waTemplates,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = difusión nueva. */
  broadcast: BroadcastWithStats | null;
  tags: ClientTag[];
  services: ServiceSlim[];
  professionals: ProfessionalSlim[];
  waTemplates: WhatsappTemplateRow[];
  onSaved: () => void;
}) {
  const editing = broadcast !== null;
  // El estado arranca de las props y no se resincroniza con un efecto: el
  // panel le cambia la `key` a este componente cada vez que lo abre, así que
  // cada apertura es un montaje nuevo con el formulario limpio.
  const [loaded] = useState(() =>
    broadcast ? readBroadcastFilters(broadcast.filters) : null,
  );
  const [draft, setDraft] = useState<Draft>(() =>
    broadcast && loaded ? draftOf(broadcast, loaded.filters) : EMPTY_DRAFT,
  );
  const [when, setWhen] = useState<WhenKind>(() =>
    broadcast?.status === "scheduled" && broadcast.scheduled_for ? "at" : "now",
  );
  const [at, setAt] = useState(() =>
    broadcast?.status === "scheduled" && broadcast.scheduled_for
      ? localInputValue(broadcast.scheduled_for)
      : nextRoundHour(new Date()),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const preview = useAudiencePreview(open, draft.filters);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function insertVariable(key: string) {
    patch({ messageBody: `${draft.messageBody}{{${key}}}` });
  }

  function submit(schedule: BroadcastSchedule) {
    const input: BroadcastInput = {
      name: draft.name,
      filters: draft.filters,
      sendMode: draft.sendMode,
      messageBody: draft.messageBody,
      templateName: draft.templateName,
      templateLanguage: draft.templateLanguage,
      templateParams: draft.templateParams,
    };

    // La misma validación que el servidor, antes de viajar: el error queda
    // al lado del campo y no como un toast genérico.
    const parsed = broadcastSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      if (next.filters) toast.error("Revisá los filtros del segmento.");
      return;
    }
    setErrors({});

    if (schedule.kind !== "draft") {
      const count = preview.data?.count;
      if (count === 0) {
        toast.error("Con estos filtros no le llega a nadie.");
        return;
      }
      const who =
        count === undefined
          ? "a las clientas del segmento"
          : `a ${count} clienta${count === 1 ? "" : "s"}`;
      const verb = schedule.kind === "now" ? "Se va a mandar" : "Se va a programar";
      if (!confirm(`${verb} "${draft.name.trim()}" ${who}. ¿Seguimos?`)) {
        return;
      }
    }

    startTransition(async () => {
      const result = await saveBroadcastAction(
        broadcast?.id ?? null,
        input,
        schedule,
      );
      if (result.fieldErrors) {
        setErrors(result.fieldErrors);
        return;
      }
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        schedule.kind === "draft"
          ? "Borrador guardado."
          : schedule.kind === "now"
            ? "Difusión en camino. Arranca en unos segundos."
            : "Difusión programada.",
      );
      onSaved();
      onOpenChange(false);
    });
  }

  const outsideWindowNow = open && !isWithinSendWindow(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar difusión" : "Nueva difusión"}</DialogTitle>
          <DialogDescription>
            Un mismo mensaje por WhatsApp a un grupo de clientas armado con
            filtros. Cada una lo recibe en su chat, como un mensaje individual.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Section n={1} title="Nombre">
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Promo color noviembre"
              aria-invalid={!!errors.name}
            />
            <FieldError message={errors.name} />
            <p className="text-[11px] text-muted-foreground">
              Solo lo ven ustedes, para reconocerla en la lista.
            </p>
          </Section>

          <Section n={2} title="A quiénes">
            {loaded && loaded.dropped > 0 ? (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {loaded.dropped === 1
                  ? "Un filtro guardado no se pudo leer y se quitó."
                  : `${loaded.dropped} filtros guardados no se pudieron leer y se quitaron.`}{" "}
                Revisá el segmento antes de mandarla: puede estar llegándole a
                más clientas de las que pensabas.
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <BroadcastFiltersEditor
                value={draft.filters}
                onChange={(filters) => patch({ filters })}
                tags={tags}
                services={services}
                professionals={professionals}
              />
              <AudienceBox preview={preview} />
            </div>
          </Section>

          <Section n={3} title="Mensaje">
            <FlowTemplateFields
              templates={waTemplates}
              sendMode={draft.sendMode}
              onSendModeChange={(sendMode) => patch({ sendMode })}
              templateName={draft.templateName}
              templateLanguage={draft.templateLanguage}
              onTemplateChange={(templateName, templateLanguage) =>
                patch({ templateName, templateLanguage })
              }
              params={draft.templateParams}
              onParamsChange={(templateParams) => patch({ templateParams })}
              variables={BROADCAST_VARIABLES}
              freeTextSubtitle="Solo a quien escribió en 24 h"
              freeTextNote="WhatsApp solo acepta texto libre con las clientas que escribieron en las últimas 24 h. Al resto del segmento la difusión la saltea y lo deja anotado. Para llegarle a todas, usá una plantilla aprobada."
              previewNote="{{nombre}} se reemplaza por el nombre de pila de cada clienta al momento de enviar."
              error={errors.templateName}
            />

            {draft.sendMode === "text" ? (
              <div className="space-y-1.5">
                <Label>Texto</Label>
                <Textarea
                  rows={5}
                  value={draft.messageBody}
                  onChange={(e) => patch({ messageBody: e.target.value })}
                  placeholder="Hola {{nombre}}! Este mes tenemos 20% en color 💛"
                  aria-invalid={!!errors.messageBody}
                />
                <div className="flex flex-wrap gap-1.5">
                  {BROADCAST_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="inline-flex items-center rounded-full border bg-muted/30 px-2 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted"
                      title={v.label}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
                <FieldError message={errors.messageBody} />
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Meta cobra cada plantilla que sale según su categoría (las de
                marketing son las más caras). El costo depende de la tarifa de
                tu cuenta de WhatsApp Business.
              </p>
            )}
          </Section>

          <Section n={4} title="Cuándo">
            <div className="grid grid-cols-2 gap-2">
              <WhenButton
                active={when === "now"}
                onClick={() => setWhen("now")}
                icon={<Send className="size-4" />}
                title="Ahora"
                subtitle="Sale apenas se guarda"
              />
              <WhenButton
                active={when === "at"}
                onClick={() => setWhen("at")}
                icon={<CalendarClock className="size-4" />}
                title="Programar"
                subtitle="Elegí día y hora"
              />
            </div>
            {when === "at" ? (
              <div className="space-y-1">
                <Input
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  className="w-auto"
                  aria-invalid={!!errors.scheduledFor}
                />
                <FieldError message={errors.scheduledFor} />
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Las difusiones salen solo {SEND_WINDOW_LABEL} y de a poco, para no
              tapar los chats de la bandeja. Lo que no llegue a salir a las 21
              sigue a las 9 del día siguiente.
              {when === "now" && outsideWindowNow ? (
                <strong className="text-foreground">
                  {" "}
                  Ahora está fuera de ese horario: arranca a las 9.
                </strong>
              ) : null}
            </p>
          </Section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => submit({ kind: "draft" })}
          >
            <Save className="size-4" />
            Guardar borrador
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              submit(when === "now" ? { kind: "now" } : { kind: "at", at })
            }
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : when === "now" ? (
              <Send className="size-4" />
            ) : (
              <CalendarClock className="size-4" />
            )}
            {when === "now" ? "Enviar ahora" : "Programar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Vista previa del segmento

type PreviewState = {
  loading: boolean;
  data: AudiencePreview | null;
};

const INCOMPLETE_FILTERS: AudiencePreview = {
  error: "Completá los filtros para ver a quiénes les llega.",
};

/**
 * Recalcula el segmento en el servidor mientras se editan los filtros, con
 * un rebote para no disparar una consulta por tecla.
 *
 * Cada respuesta se guarda junto con los filtros que la pidieron: "está
 * cargando" es simplemente que la última respuesta no corresponde a los
 * filtros de ahora. Eso además descarta solas las respuestas viejas que
 * lleguen tarde.
 */
function useAudiencePreview(
  open: boolean,
  filters: BroadcastFilters,
): PreviewState {
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const parsed = useMemo(
    () => broadcastFiltersSchema.safeParse(JSON.parse(key)),
    [key],
  );
  const [result, setResult] = useState<{
    key: string;
    data: AudiencePreview;
  } | null>(null);
  useEffect(() => {
    if (!open || !parsed.success) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const data = await previewBroadcastAudienceAction(parsed.data);
      if (alive) setResult({ key, data });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, key, parsed]);

  if (!parsed.success) return { loading: false, data: INCOMPLETE_FILTERS };
  if (result?.key === key) return { loading: false, data: result.data };
  // Mientras se recalcula queda a la vista el número anterior, atenuado, en
  // vez de vaciar el recuadro con cada cambio.
  return { loading: true, data: result?.data ?? null };
}

function AudienceBox({ preview }: { preview: PreviewState }) {
  const { loading, data } = preview;
  const count = data?.count;

  return (
    <aside className="h-fit space-y-2 rounded-lg border bg-muted/10 p-3 md:sticky md:top-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        Le llega a
        {loading ? <Loader2 className="ml-auto size-3.5 animate-spin" /> : null}
      </div>

      {data?.error ? (
        <p className="text-xs text-muted-foreground">{data.error}</p>
      ) : count === undefined ? (
        <p className="text-xs text-muted-foreground">Calculando…</p>
      ) : (
        <>
          <p
            className={cn(
              "font-display text-3xl font-bold leading-none tabular-nums transition-opacity",
              loading && "opacity-50",
            )}
          >
            {count}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              clienta{count === 1 ? "" : "s"}
            </span>
          </p>

          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {data?.excluded ? (
              <li>{data.excluded} excluidas por las reglas de abajo</li>
            ) : null}
            {data?.noPhone ? (
              <li>{data.noPhone} sin teléfono en la ficha (quedan afuera)</li>
            ) : null}
            {data?.duplicates ? (
              <li>
                {data.duplicates} con un número repetido (les llega un solo
                mensaje)
              </li>
            ) : null}
          </ul>

          {data?.shortPhones ? (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {data.shortPhones} no tiene{data.shortPhones === 1 ? "" : "n"}{" "}
              código de país en el teléfono (por ejemplo 54 9 para Argentina)
              ni chat en el WhatsApp nuevo: se van a saltear. Corregilos en la
              ficha de cada clienta.
            </p>
          ) : null}

          {data?.sample && data.sample.length > 0 ? (
            <div className="space-y-0.5 border-t pt-2">
              <p className="text-[11px] text-muted-foreground">Por ejemplo:</p>
              <ul className="text-xs">
                {data.sample.map((name, i) => (
                  <li key={`${name}-${i}`} className="truncate">
                    {name}
                  </li>
                ))}
                {count > data.sample.length ? (
                  <li className="text-muted-foreground">
                    y {count - data.sample.length} más
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

// ───────────────────────────── Piezas

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-gold/15 text-[11px] text-gold tabular-nums">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-destructive">{message}</p>;
}

function WhenButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
        active ? "border-gold bg-gold/10" : "bg-background hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </button>
  );
}
