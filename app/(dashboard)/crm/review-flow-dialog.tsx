"use client";

import { CheckCheck, Loader2, Plus, Star, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_REVIEW_QUESTION,
  DEFAULT_REVIEW_REPLY_HIGH,
  DEFAULT_REVIEW_REPLY_LOW,
  DEFAULT_REVIEW_REPLY_MID,
  REVIEW_CASE_THRESHOLD,
} from "@/lib/reviews";
import { cn } from "@/lib/utils";
import {
  formatOffsetMinutes,
  renderTemplate,
  REVIEW_QUESTION_VARIABLES,
  REVIEW_REPLY_VARIABLES,
} from "@/lib/validations/crm-config";
import {
  createReviewFlowAction,
  updateReviewFlowAction,
} from "./config-actions";
import type { AutomationFlow, ServiceSlim } from "./config-types";

type OffsetUnit = "min" | "h" | "d";

const UNIT_LABEL: Record<OffsetUnit, string> = {
  min: "Minutos",
  h: "Horas",
  d: "Días",
};

function fromMinutes(mins: number): { value: number; unit: OffsetUnit } {
  if (mins === 0) return { value: 0, unit: "min" };
  if (mins % 1440 === 0) return { value: mins / 1440, unit: "d" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "h" };
  return { value: mins, unit: "min" };
}

function toMinutes(value: number, unit: OffsetUnit): number {
  if (unit === "d") return value * 1440;
  if (unit === "h") return value * 60;
  return value;
}

/** Datos de mentira para la vista previa: los mismos que usa el mock. */
const SAMPLE_NAME = "Martina";
const SAMPLE_SERVICE = "Color + brushing";
const SAMPLE_PROFESSIONAL = "Caro";

type FormState = {
  name: string;
  offsetValue: number;
  offsetUnit: OffsetUnit;
  serviceFilterIds: string[];
  salonName: string;
  googleUrl: string;
  question: string;
  replyHigh: string;
  replyMid: string;
  replyLow: string;
  active: boolean;
};

const EMPTY: FormState = {
  name: "",
  offsetValue: 5,
  offsetUnit: "min",
  serviceFilterIds: [],
  salonName: "",
  googleUrl: "",
  question: "",
  replyHigh: "",
  replyMid: "",
  replyLow: "",
  active: true,
};

/**
 * Editor del flujo "Pedido de reseña".
 *
 * Es un diálogo aparte del de flujos comunes y no una variante del mismo,
 * porque lo que se edita acá no es "un mensaje" sino una conversación entera:
 * la pregunta y las tres respuestas tienen que leerse juntas para que el tono
 * cierre. De ahí también las burbujas de vista previa: el salón escribe con
 * variables pero manda texto, y la diferencia entre los dos es justo donde se
 * cuelan los errores.
 *
 * Los cuatro textos son opcionales en el formulario: vacío = el texto por
 * defecto, que es el que muestra el placeholder. Así el flujo se crea con
 * poner un nombre.
 */
export function ReviewFlowDialog({
  open,
  onOpenChange,
  flow,
  services,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flow: AutomationFlow | null;
  services: ServiceSlim[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* El formulario se monta de cero por flujo: `key` hace que el estado
            inicial se calcule de las props en vez de sincronizarse con un
            efecto, que es lo que dejaba el editor con datos del flujo
            anterior si se abrían dos seguidos. */}
        {open ? (
          <ReviewFlowForm
            key={flow?.id ?? "new"}
            flow={flow}
            services={services}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function initialState(flow: AutomationFlow | null): FormState {
  if (!flow) return EMPTY;
  const { value, unit } = fromMinutes(flow.trigger_offset_minutes);
  return {
    name: flow.name,
    offsetValue: value,
    offsetUnit: unit,
    serviceFilterIds: flow.service_filter_ids,
    salonName: flow.review_salon_name ?? "",
    googleUrl: flow.review_google_url ?? "",
    question: flow.message_body,
    replyHigh: flow.review_reply_high ?? "",
    replyMid: flow.review_reply_mid ?? "",
    replyLow: flow.review_reply_low ?? "",
    active: flow.active,
  };
}

function ReviewFlowForm({
  flow,
  services,
  onDone,
}: {
  flow: AutomationFlow | null;
  services: ServiceSlim[];
  onDone: () => void;
}) {
  const editing = flow !== null;
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(flow));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  const available = services.filter(
    (s) => !form.serviceFilterIds.includes(s.id),
  );

  // Lo que realmente se manda: el placeholder no es decoración, es el default.
  const effective = {
    question: form.question.trim() || DEFAULT_REVIEW_QUESTION,
    replyHigh: form.replyHigh.trim() || DEFAULT_REVIEW_REPLY_HIGH,
    replyMid: form.replyMid.trim() || DEFAULT_REVIEW_REPLY_MID,
    replyLow: form.replyLow.trim() || DEFAULT_REVIEW_REPLY_LOW,
  };

  function preview(template: string): string {
    return renderTemplate(template, {
      nombre: SAMPLE_NAME,
      salon: form.salonName.trim() || "tu salón",
      servicio: SAMPLE_SERVICE,
      profesional: SAMPLE_PROFESSIONAL,
      link: form.googleUrl.trim() || "(falta el link de Google)",
      fecha: "",
      hora: "",
    });
  }

  function onSubmit() {
    const formData = new FormData();
    formData.set("name", form.name.trim());
    formData.set(
      "triggerOffsetMinutes",
      String(toMinutes(form.offsetValue, form.offsetUnit)),
    );
    formData.set("serviceFilterIds", form.serviceFilterIds.join(","));
    formData.set("salonName", form.salonName.trim());
    formData.set("googleUrl", form.googleUrl.trim());
    formData.set("question", effective.question);
    formData.set("replyHigh", effective.replyHigh);
    formData.set("replyMid", effective.replyMid);
    formData.set("replyLow", effective.replyLow);
    formData.set("active", String(form.active));

    startTransition(async () => {
      const result = editing
        ? await updateReviewFlowAction(flow.id, formData)
        : await createReviewFlowAction(formData);
      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) setErrors(result.fieldErrors);
      else if (result.success) {
        toast.success(
          editing ? "Pedido de reseña actualizado." : "Pedido de reseña creado.",
        );
        onDone();
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Star className="size-4 text-gold" />
          Pedido de reseña
        </DialogTitle>
        <DialogDescription>
          Después de cobrar el turno le preguntamos a la clienta cómo fue su
          experiencia del 1 al 5, ahí mismo en el chat. Un 5 la lleva a
          Google; un puntaje bajo abre un caso interno para que lo resuelvas
          en privado.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* ─── Nombre ─── */}
        <div className="space-y-2">
          <Label htmlFor="review-name">Nombre del flujo</Label>
          <Input
            id="review-name"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Pedido de reseña"
          />
          {errors.name ? (
            <p className="text-xs text-destructive">{errors.name}</p>
          ) : null}
        </div>

        {/* ─── Activo ─── */}
        <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="review-active">Activo</Label>
            <p className="text-xs text-muted-foreground">
              Si está apagado, queda guardado pero no envía nada.
            </p>
          </div>
          <Switch
            id="review-active"
            checked={form.active}
            onCheckedChange={(v) => patch({ active: v })}
          />
        </div>

        {/* ─── Cuándo ─── */}
        <div className="space-y-2">
          <Label>Cuándo se envía</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step={1}
              className="w-24 tabular-nums"
              value={form.offsetValue}
              onChange={(e) =>
                patch({ offsetValue: e.target.valueAsNumber || 0 })
              }
            />
            <Select
              value={form.offsetUnit}
              onValueChange={(v) => patch({ offsetUnit: v as OffsetUnit })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["min", "h", "d"] as OffsetUnit[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Sale{" "}
            <strong className="text-foreground">
              {formatOffsetMinutes(
                toMinutes(form.offsetValue, form.offsetUnit),
              )}
            </strong>{" "}
            después de cobrar el turno.
          </p>
        </div>

        {/* ─── Servicios ─── */}
        <div className="space-y-2">
          <Label>Aplica a estos servicios (opcional)</Label>
          <p className="text-xs text-muted-foreground">
            Si no elegís ninguno, se aplica a{" "}
            <strong className="text-foreground">todos los servicios</strong>.
          </p>
          <Select
            value=""
            onValueChange={(id) =>
              patch({ serviceFilterIds: [...form.serviceFilterIds, id] })
            }
            disabled={available.length === 0}
          >
            <SelectTrigger className="w-full">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Plus className="size-4" />
                Agregar servicio...
              </span>
            </SelectTrigger>
            <SelectContent>
              {available.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.serviceFilterIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {form.serviceFilterIds.map((id) => (
                <Badge
                  key={id}
                  variant="outline"
                  className="gap-1 text-xs font-normal"
                >
                  {serviceById.get(id)?.name ?? "?"}
                  <button
                    type="button"
                    aria-label="Quitar servicio"
                    onClick={() =>
                      patch({
                        serviceFilterIds: form.serviceFilterIds.filter(
                          (s) => s !== id,
                        ),
                      })
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {/* ─── Datos del salón ─── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="review-salon">Nombre del salón</Label>
            <Input
              id="review-salon"
              value={form.salonName}
              onChange={(e) => patch({ salonName: e.target.value })}
              placeholder="PELU TEST"
            />
            <p className="text-xs text-muted-foreground">
              Es lo que reemplaza a <code>{`{{salon}}`}</code>.
            </p>
            {errors.salonName ? (
              <p className="text-xs text-destructive">{errors.salonName}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-link">Link de reseña de Google</Label>
            <Input
              id="review-link"
              value={form.googleUrl}
              onChange={(e) => patch({ googleUrl: e.target.value })}
              placeholder="https://g.page/r/…/review"
            />
            <p className="text-xs text-muted-foreground">
              Es lo que reemplaza a <code>{`{{link}}`}</code>.
            </p>
            {errors.googleUrl ? (
              <p className="text-xs text-destructive">{errors.googleUrl}</p>
            ) : null}
          </div>
        </div>

        {/* ─── La pregunta ─── */}
        <div className="space-y-2">
          <Label htmlFor="review-question">Primer mensaje (la pregunta)</Label>
          <Textarea
            id="review-question"
            rows={8}
            value={form.question}
            onChange={(e) => patch({ question: e.target.value })}
            placeholder={DEFAULT_REVIEW_QUESTION}
          />
          <p className="text-xs text-muted-foreground">
            Si lo dejás vacío, sale el mensaje original.
          </p>
          <VariableChips
            variables={REVIEW_QUESTION_VARIABLES}
            onInsert={(key) =>
              patch({ question: `${form.question}{{${key}}}` })
            }
          />
          <BubblePreview label="Así lo recibe la clienta">
            {preview(effective.question)}
          </BubblePreview>
          {errors.question ? (
            <p className="text-xs text-destructive">{errors.question}</p>
          ) : null}
        </div>

        <Separator />

        {/* ─── Respuestas ─── */}
        <div className="space-y-1">
          <h3 className="font-medium">Respuestas según el puntaje</h3>
          <p className="text-sm text-muted-foreground">
            La clienta responde con un número del 1 al 5 y el sistema contesta
            solo. Un puntaje de {REVIEW_CASE_THRESHOLD} o menos abre un caso
            interno en Reseñas.
          </p>
        </div>

        <ReplyField
          id="review-high"
          label="Si responde 5"
          value={form.replyHigh}
          fallback={DEFAULT_REVIEW_REPLY_HIGH}
          onChange={(v) => patch({ replyHigh: v })}
          preview={preview(effective.replyHigh)}
          error={errors.replyHigh}
        />
        <ReplyField
          id="review-mid"
          label="Si responde 3 o 4"
          value={form.replyMid}
          fallback={DEFAULT_REVIEW_REPLY_MID}
          onChange={(v) => patch({ replyMid: v })}
          preview={preview(effective.replyMid)}
          error={errors.replyMid}
        />
        <ReplyField
          id="review-low"
          label="Si responde 1 o 2"
          value={form.replyLow}
          fallback={DEFAULT_REVIEW_REPLY_LOW}
          onChange={(v) => patch({ replyLow: v })}
          preview={preview(effective.replyLow)}
          error={errors.replyLow}
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onDone()}
        >
          Cancelar
        </Button>
        <Button type="button" onClick={onSubmit} disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Star className="size-4" />
          )}
          {editing ? "Guardar cambios" : "Crear pedido de reseña"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReplyField({
  id,
  label,
  value,
  fallback,
  onChange,
  preview,
  error,
}: {
  id: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  preview: string;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fallback}
      />
      <VariableChips
        variables={REVIEW_REPLY_VARIABLES}
        onInsert={(key) => onChange(`${value}{{${key}}}`)}
      />
      <BubblePreview>{preview}</BubblePreview>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function VariableChips({
  variables,
  onInsert,
}: {
  variables: readonly { key: string; label: string }[];
  onInsert: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {variables.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onInsert(v.key)}
          title={`Insertar {{${v.key}}}`}
          className="rounded-md bg-gold-soft px-2 py-1 text-xs text-foreground/80 hover:text-foreground transition-colors"
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Burbuja de WhatsApp con los mismos tokens que la bandeja real. */
function BubblePreview({
  label,
  children,
  className,
}: {
  label?: string;
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <p className="text-xs text-muted-foreground">{label}</p>
      ) : null}
      <div className="rounded-lg bg-muted/40 p-3">
        <div className="ml-auto max-w-[85%] rounded-lg bg-[var(--wa-bubble-out)] px-3 py-2 text-sm text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)] whitespace-pre-wrap break-words">
          {children}
          <span className="mt-1 flex items-center justify-end gap-1 text-[0.7rem] text-[var(--wa-meta-out)]">
            14:32
            <CheckCheck className="size-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
