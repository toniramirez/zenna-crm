"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlarmClock,
  Loader2,
  Pencil,
  Plus,
  Power,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  APPOINTMENT_TRIGGERS,
  automationFlowSchema,
  type AutomationFlowInput,
  type AutomationSendMode,
  type AutomationTrigger,
  EMPTY_TEMPLATE_PARAMS_INPUT,
  formatOffsetMinutes,
  TEMPLATE_VARIABLES,
  TRIGGER_LABEL,
  TRIGGERS,
} from "@/lib/validations/crm-config";
import { buttonRepliesOf } from "@/lib/automations/buttons";
import { templateParamsOf } from "@/lib/automations/message";
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import { REVIEW_CASE_THRESHOLD } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import {
  createFlowAction,
  deleteFlowAction,
  updateFlowAction,
} from "./config-actions";
import type { AutomationFlow, ServiceSlim } from "./config-types";
import { describeSendMode, FlowTemplateFields } from "./flow-template-fields";
import { ReviewFlowDialog } from "./review-flow-dialog";

// Convert mins → { value, unit } for friendly editor
function fromMinutes(mins: number): { value: number; unit: "min" | "h" | "d" } {
  if (mins === 0) return { value: 0, unit: "min" };
  if (mins % 1440 === 0) return { value: mins / 1440, unit: "d" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "h" };
  return { value: mins, unit: "min" };
}

function toMinutes(value: number, unit: "min" | "h" | "d"): number {
  if (unit === "d") return value * 1440;
  if (unit === "h") return value * 60;
  return value;
}

export function AutomationsManager({
  flows,
  services,
  waTemplates = [],
}: {
  flows: AutomationFlow[];
  services: ServiceSlim[];
  /** Plantillas aprobadas del WABA, para los flujos en modo plantilla. */
  waTemplates?: WhatsappTemplateRow[];
}) {
  const [editing, setEditing] = useState<AutomationFlow | null>(null);
  const [open, setOpen] = useState(false);
  // El pedido de reseña tiene su propio editor, así que también su propio
  // estado: abrir uno mientras el otro está montado con otro flujo cargado
  // mezclaría los formularios.
  const [reviewEditing, setReviewEditing] = useState<AutomationFlow | null>(
    null,
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [, startTransition] = useTransition();

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(flow: AutomationFlow) {
    if (flow.kind === "review") {
      setReviewEditing(flow);
      setReviewOpen(true);
      return;
    }
    setEditing(flow);
    setOpen(true);
  }
  function openCreateReview() {
    setReviewEditing(null);
    setReviewOpen(true);
  }

  function handleDelete(flow: AutomationFlow) {
    if (!confirm(`¿Eliminar el flujo "${flow.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteFlowAction(flow.id);
      if (result.error) toast.error(result.error);
      else toast.success("Flujo eliminado.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Mensajes automáticos vinculados a turnos. Configurás &quot;cuándo&quot;
          (antes del turno, después, o después de cobrarlo) y &quot;a
          quiénes&quot; (todas las clientas o solo las que reservaron ciertos
          servicios). El worker dispara los envíos cada minuto.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={openCreateReview} size="sm" variant="outline">
            <Star className="size-4" />
            Pedido de reseña
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4" />
            Nuevo flujo
          </Button>
        </div>
      </div>

      {flows.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground space-y-2">
          <Zap className="size-5 mx-auto text-gold" />
          <p>Sin flujos creados todavía.</p>
          <p className="text-xs">
            Ejemplo: &quot;Recordatorio 24h antes&quot; — manda un mensaje
            recordando el turno el día previo.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {flows.map((f) => (
            <div
              key={f.id}
              className={cn(
                "rounded-xl border bg-card p-4 space-y-2",
                !f.active && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    {f.kind === "review" ? (
                      <Star className="size-3.5 shrink-0 text-gold" />
                    ) : null}
                    <span className="truncate">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground flex-wrap">
                    <AlarmClock className="size-3" />
                    <span>
                      {TRIGGER_LABEL[f.trigger]} ·{" "}
                      <strong className="text-foreground">
                        {formatOffsetMinutes(f.trigger_offset_minutes)}
                      </strong>
                    </span>
                  </div>
                </div>
                {!f.active ? (
                  <Badge variant="outline" className="text-[10px]">
                    Inactivo
                  </Badge>
                ) : null}
              </div>

              {APPOINTMENT_TRIGGERS.includes(f.trigger) ? (
                <div className="text-xs text-muted-foreground">
                  Aplica a:{" "}
                  {f.service_filter_ids.length === 0 ? (
                    <span className="font-medium text-foreground">
                      Todos los servicios
                    </span>
                  ) : (
                    <span className="space-x-1">
                      {f.service_filter_ids.map((id) => (
                        <Badge
                          key={id}
                          variant="outline"
                          className="text-[10px] font-normal"
                        >
                          {serviceById.get(id)?.name ?? "?"}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Aplica al primer mensaje entrante o tras{" "}
                  <strong className="text-foreground">
                    {formatOffsetMinutes(f.trigger_offset_minutes)}
                  </strong>{" "}
                  de inactividad.
                </div>
              )}

              {describeSendMode(f) ? (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {describeSendMode(f)}
                </Badge>
              ) : null}

              <div className="rounded-md bg-muted/30 px-2.5 py-1.5 text-xs whitespace-pre-wrap line-clamp-3">
                {f.message_body}
              </div>

              {f.kind === "review" ? (
                <div className="text-xs text-muted-foreground">
                  Responde sola según el puntaje. Un{" "}
                  <strong className="text-foreground">5</strong> lleva a Google;{" "}
                  <strong className="text-foreground">
                    {REVIEW_CASE_THRESHOLD} o menos
                  </strong>{" "}
                  abre un caso en{" "}
                  <Link href="/resenas" className="underline">
                    Reseñas
                  </Link>
                  .
                  {f.review_google_url ? null : (
                    <span className="text-destructive">
                      {" "}
                      Falta cargar el link de Google.
                    </span>
                  )}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(f)}
                >
                  <Pencil className="size-3.5" />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete(f)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FlowDialog
        open={open}
        onOpenChange={setOpen}
        flow={editing}
        services={services}
        waTemplates={waTemplates}
      />

      <ReviewFlowDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        flow={reviewEditing}
        services={services}
        waTemplates={waTemplates}
      />
    </div>
  );
}

function FlowDialog({
  open,
  onOpenChange,
  flow,
  services,
  waTemplates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flow: AutomationFlow | null;
  services: ServiceSlim[];
  waTemplates: WhatsappTemplateRow[];
}) {
  const editing = flow !== null;
  const [isPending, startTransition] = useTransition();
  const [offsetValue, setOffsetValue] = useState(24);
  const [offsetUnit, setOffsetUnit] = useState<"min" | "h" | "d">("h");

  const form = useForm<AutomationFlowInput>({
    resolver: zodResolver(automationFlowSchema),
    defaultValues: {
      name: "",
      trigger: "before_appointment",
      triggerOffsetMinutes: 1440,
      serviceFilterIds: [],
      messageBody: "",
      sendMode: "text",
      templateName: "",
      templateLanguage: "",
      templateParams: EMPTY_TEMPLATE_PARAMS_INPUT,
      buttonReplies: [],
      active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (flow) {
      const { value, unit } = fromMinutes(flow.trigger_offset_minutes);
      setOffsetValue(value);
      setOffsetUnit(unit);
      form.reset({
        name: flow.name,
        trigger: flow.trigger,
        triggerOffsetMinutes: flow.trigger_offset_minutes,
        serviceFilterIds: flow.service_filter_ids,
        messageBody: flow.message_body,
        sendMode: flow.send_mode === "template" ? "template" : "text",
        templateName: flow.template_name ?? "",
        templateLanguage: flow.template_language ?? "",
        templateParams: templateParamsOf(flow.template_params),
        buttonReplies: buttonRepliesOf(flow.button_replies),
        active: flow.active,
      });
    } else {
      setOffsetValue(24);
      setOffsetUnit("h");
      form.reset({
        name: "",
        trigger: "before_appointment",
        triggerOffsetMinutes: 1440,
        serviceFilterIds: [],
        messageBody: "",
        sendMode: "text",
        templateName: "",
        templateLanguage: "",
        templateParams: EMPTY_TEMPLATE_PARAMS_INPUT,
        buttonReplies: [],
        active: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flow?.id]);

  function syncOffset(value: number, unit: "min" | "h" | "d") {
    setOffsetValue(value);
    setOffsetUnit(unit);
    form.setValue("triggerOffsetMinutes", toMinutes(value, unit));
  }

  function insertVariable(key: string) {
    const current = form.getValues("messageBody");
    form.setValue("messageBody", `${current}{{${key}}}`);
  }

  function onSubmit(values: AutomationFlowInput) {
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("trigger", values.trigger);
    formData.set("triggerOffsetMinutes", String(values.triggerOffsetMinutes));
    formData.set("serviceFilterIds", values.serviceFilterIds.join(","));
    formData.set("messageBody", values.messageBody);
    formData.set("sendMode", values.sendMode);
    formData.set("templateName", values.templateName ?? "");
    formData.set("templateLanguage", values.templateLanguage ?? "");
    formData.set("templateParams", JSON.stringify(values.templateParams));
    formData.set("buttonReplies", JSON.stringify(values.buttonReplies));
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updateFlowAction(flow.id, formData)
        : await createFlowAction(formData);
      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) {
        for (const [name, msg] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof AutomationFlowInput, { message: msg });
        }
      } else if (result.success) {
        toast.success(editing ? "Flujo actualizado." : "Flujo creado.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar flujo" : "Nuevo flujo de automatización"}
          </DialogTitle>
          <DialogDescription>
            Definí cuándo se dispara, a qué servicios aplica, y qué mensaje
            enviar.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del flujo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Recordatorio 24h antes"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Cuándo se dispara</FormLabel>
              <div className="grid grid-cols-[1fr_100px_100px] gap-2">
                <Select
                  value={form.watch("trigger")}
                  onValueChange={(v) => {
                    const next = v as AutomationTrigger;
                    form.setValue("trigger", next);
                    // Triggers that don't operate on appointments can't carry
                    // a service filter; clear it when switching to one.
                    if (!APPOINTMENT_TRIGGERS.includes(next)) {
                      form.setValue("serviceFilterIds", []);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={offsetValue}
                  onChange={(e) =>
                    syncOffset(e.target.valueAsNumber || 0, offsetUnit)
                  }
                  className="tabular-nums"
                />
                <Select
                  value={offsetUnit}
                  onValueChange={(v) =>
                    syncOffset(offsetValue, v as "min" | "h" | "d")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="min">min</SelectItem>
                    <SelectItem value="h">horas</SelectItem>
                    <SelectItem value="d">días</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Total:{" "}
                <strong>
                  {formatOffsetMinutes(toMinutes(offsetValue, offsetUnit))}
                </strong>{" "}
                {form.watch("trigger") === "before_appointment"
                  ? "antes del inicio del turno"
                  : form.watch("trigger") === "after_appointment"
                    ? "después de que termine el turno"
                    : form.watch("trigger") === "after_payment"
                      ? "después de que se cobre el turno"
                      : "de inactividad mínima entre mensajes entrantes (las conversaciones nuevas siempre disparan)"}
                .
              </p>
            </div>

            {APPOINTMENT_TRIGGERS.includes(form.watch("trigger")) ? (
              <FormField
                control={form.control}
                name="serviceFilterIds"
                render={({ field }) => {
                  const value = field.value ?? [];
                  return (
                    <FormItem>
                      <FormLabel>Aplica a estos servicios (opcional)</FormLabel>
                      <FormDescription>
                        Si no elegís ninguno, el flujo se dispara para CUALQUIER
                        turno. Si elegís uno o más, solo se dispara cuando el
                        turno incluye alguno de esos servicios.
                      </FormDescription>
                      <div className="rounded-md border max-h-44 overflow-y-auto">
                        {services.length === 0 ? (
                          <p className="p-3 text-sm text-muted-foreground">
                            No hay servicios activos cargados.
                          </p>
                        ) : (
                          <ul className="divide-y">
                            {services.map((s) => {
                              const checked = value.includes(s.id);
                              const toggle = () => {
                                field.onChange(
                                  checked
                                    ? value.filter((v) => v !== s.id)
                                    : [...value, s.id],
                                );
                              };
                              const id = `flow-service-${s.id}`;
                              return (
                                <li key={s.id}>
                                  <label
                                    htmlFor={id}
                                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30"
                                  >
                                    <Checkbox
                                      id={id}
                                      checked={checked}
                                      onCheckedChange={toggle}
                                    />
                                    <span className="text-sm">{s.name}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      {value.length === 0 ? (
                        <Badge variant="outline" className="text-xs font-normal">
                          Se aplica a TODOS los servicios
                        </Badge>
                      ) : (
                        <Badge className="text-xs">
                          {value.length} servicio
                          {value.length === 1 ? "" : "s"} seleccionados
                        </Badge>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            ) : (
              <div className="rounded-md border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
                Este trigger reacciona a mensajes entrantes de WhatsApp, no a
                turnos. Solo <code>{`{{nombre}}`}</code> tiene valor (las otras
                variables quedan vacías).
              </div>
            )}

            <FlowTemplateFields
              templates={waTemplates}
              sendMode={form.watch("sendMode")}
              onSendModeChange={(mode: AutomationSendMode) =>
                form.setValue("sendMode", mode, { shouldValidate: true })
              }
              templateName={form.watch("templateName") ?? ""}
              templateLanguage={form.watch("templateLanguage") ?? ""}
              onTemplateChange={(name, language) => {
                form.setValue("templateName", name, { shouldValidate: true });
                form.setValue("templateLanguage", language);
              }}
              params={form.watch("templateParams")}
              onParamsChange={(next) => form.setValue("templateParams", next)}
              buttonReplies={form.watch("buttonReplies")}
              onButtonRepliesChange={(next) =>
                form.setValue("buttonReplies", next)
              }
              variables={TEMPLATE_VARIABLES}
              error={form.formState.errors.templateName?.message}
            />

            {/*
              El cuerpo libre solo se muestra cuando es lo que se manda. El
              valor sigue en el formulario al cambiar de modo, así que probar
              con una plantilla y volver atrás no pierde el texto escrito.
            */}
            {form.watch("sendMode") === "text" ? (
              <FormField
                control={form.control}
                name="messageBody"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensaje a enviar</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={5}
                        placeholder="Hola {{nombre}}, te recordamos tu turno mañana a las {{hora}} con {{profesional}} para {{servicio}}. Te esperamos! 💛"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => insertVariable(v.key)}
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-mono hover:bg-muted transition-colors"
                          title={v.label}
                        >
                          {`{{${v.key}}}`}
                        </button>
                      ))}
                    </div>
                    <FormDescription>
                      Click en una variable para insertarla. Se reemplazan al
                      momento de enviar.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Activo</FormLabel>
                    <FormDescription>
                      Solo los flujos activos se ejecutan.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Power className="size-4" />
                )}
                {editing ? "Guardar cambios" : "Crear flujo"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
