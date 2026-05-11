"use client";

import type {
  DateSelectArg,
  EventInput,
} from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, Loader2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDuration } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/validations/services";
import {
  createClientQuickAction,
  type QuickClient,
} from "../clientas/actions";
import { createAppointmentAction } from "../turnos/actions";
import type {
  AppointmentWithRelations,
  ClientRow,
  ProfessionalRow,
  ServiceRow,
} from "../turnos/types";
import { linkConversationClientAction, sendMessageAction } from "./actions";
import type { ConversationWithClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithClient | null;
  professionals: ProfessionalRow[];
  services: ServiceRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments: AppointmentWithRelations[];
};

function jidToPhone(
  jid: string,
  waPhone?: string | null,
): string | null {
  if (jid.endsWith("@lid")) {
    const d = (waPhone ?? "").replace(/\D/g, "");
    return d.length >= 8 ? `+${d}` : null;
  }
  const digits = jid.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!digits || digits.length < 8) {
    const fallback = (waPhone ?? "").replace(/\D/g, "");
    return fallback.length >= 8 ? `+${fallback}` : null;
  }
  return `+${digits}`;
}

function joinServiceNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function buildConfirmationMessage(args: {
  startsAt: string;
  serviceNames: string[];
}): string {
  const date = new Date(args.startsAt);
  const day = format(date, "EEEE d 'de' MMMM", { locale: es });
  const time = format(date, "HH:mm", { locale: es });
  const services = joinServiceNames(args.serviceNames);
  return `¡Buenísimo! Te agendé ${services} para el ${day} a las ${time} hs. Cualquier cosa avisame ✨`;
}

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function appointmentToEvent(
  a: AppointmentWithRelations,
  proColor: string,
): EventInput {
  const isCancelled = a.status === "cancelled";
  const isNoShow = a.status === "no_show";
  const services = a.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");
  const title = `${a.clients?.full_name ?? "Sin clienta"}${services ? ` · ${services}` : ""}`;
  const bg =
    isCancelled || isNoShow
      ? "rgba(120,113,108,0.10)"
      : hexToRgba(proColor, 0.18);
  const border = isCancelled || isNoShow ? "#a8a29e" : proColor;
  return {
    id: a.id,
    resourceId: a.professional_id,
    start: a.starts_at,
    end: a.ends_at,
    title,
    backgroundColor: bg,
    borderColor: border,
    textColor: "#1c1917",
    editable: false,
  };
}

/**
 * Dialog for creating an appointment directly from a WhatsApp conversation.
 * Pre-fills the client (or opens the quick-create form when the conversation
 * has no linked client yet) and embeds a mini FullCalendar so the receptionist
 * can pick a professional + slot visually in a single click.
 */
export function NewTurnoDialog({
  open,
  onOpenChange,
  conversation,
  professionals,
  services,
  clients,
  appointments,
}: Props) {
  // ──── Client state ────────────────────────────────────────────────────────
  const hasLinkedClient = !!conversation?.clients;
  const prefilledPhone = conversation
    ? (conversation.clients?.phone ??
        jidToPhone(conversation.external_id, conversation.wa_phone) ??
        "")
    : "";
  const prefilledName = conversation?.display_name ?? "";

  // When the conversation has no linked client, we default to quick-create
  // with the WhatsApp phone already filled in. Otherwise we just show the
  // linked client read-only.
  const [clientId, setClientId] = useState<string>("");
  const [quickName, setQuickName] = useState(prefilledName);
  const [quickPhone, setQuickPhone] = useState(prefilledPhone);
  const [creatingClient, setCreatingClient] = useState(false);
  const creatingClientRef = useRef(false);
  const [addedClients, setAddedClients] = useState<QuickClient[]>([]);

  // ──── Booking state ───────────────────────────────────────────────────────
  const [professionalId, setProfessionalId] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>(""); // ISO
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  // Mobile detection — the embedded FullCalendar is unusable on phones
  // (touch slot selection is unreliable + every pro is a tiny column), so on
  // mobile we replace it with a plain Pro select + datetime input.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // Reset every time the dialog opens for a (possibly different) conversation
  useEffect(() => {
    if (!open) return;
    setClientId(conversation?.clients?.id ?? "");
    setQuickName(conversation?.display_name ?? "");
    setQuickPhone(
      conversation?.clients?.phone ??
        (conversation
          ? jidToPhone(conversation.external_id, conversation.wa_phone) ?? ""
          : ""),
    );
    setAddedClients([]);
    setProfessionalId("");
    setStartsAt("");
    setSelectedServiceIds([]);
    setNotes("");
  }, [open, conversation]);

  // ──── Derived ─────────────────────────────────────────────────────────────
  const allClients = useMemo<QuickClient[]>(
    () => [...addedClients, ...clients],
    [addedClients, clients],
  );
  const effectiveClient = allClients.find((c) => c.id === clientId) ?? null;

  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.includes(s.id)),
    [services, selectedServiceIds],
  );
  const totalDuration = selectedServices.reduce(
    (acc, s) => acc + s.duration_minutes,
    0,
  );
  const totalPrice = selectedServices.reduce(
    (acc, s) => acc + Number(s.price),
    0,
  );

  // Mini-agenda inputs
  const resources = useMemo(
    () =>
      professionals
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          title: p.full_name,
          eventBackgroundColor: p.color,
        })),
    [professionals],
  );
  const proColorById = useMemo(
    () => new Map(professionals.map((p) => [p.id, p.color])),
    [professionals],
  );

  // Build events: real appointments + a synthetic "pick" event with the
  // duration of the currently-selected services (or 30min as a fallback so
  // the slot is visible even before services are chosen).
  const events = useMemo<EventInput[]>(() => {
    const real = appointments.map((a) =>
      appointmentToEvent(a, proColorById.get(a.professional_id) ?? "#94a3b8"),
    );
    if (!startsAt || !professionalId) return real;
    const previewMinutes = totalDuration > 0 ? totalDuration : 30;
    const startD = new Date(startsAt);
    const endD = new Date(startD.getTime() + previewMinutes * 60 * 1000);
    real.push({
      id: "__pick__",
      resourceId: professionalId,
      start: startD.toISOString(),
      end: endD.toISOString(),
      title: "Nuevo turno",
      backgroundColor: "#0f172a",
      borderColor: "#0f172a",
      textColor: "#ffffff",
      editable: false,
      classNames: ["zenna-pick-event"],
    });
    return real;
  }, [appointments, proColorById, startsAt, professionalId, totalDuration]);

  function toggleService(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function handleSelect(arg: DateSelectArg) {
    const resourceId =
      arg.resource?.id ?? professionals.find((p) => p.active)?.id ?? null;
    if (!resourceId) {
      toast.error("Cargá una profesional activa primero.");
      arg.view.calendar.unselect();
      return;
    }
    setProfessionalId(resourceId);
    setStartsAt(arg.start.toISOString());
    arg.view.calendar.unselect();
  }

  async function handleQuickCreate(): Promise<string | null> {
    if (creatingClientRef.current) return null;
    if (quickName.trim().length < 2) {
      toast.error("El nombre es muy corto.");
      return null;
    }
    creatingClientRef.current = true;
    setCreatingClient(true);
    try {
      const result = await createClientQuickAction(quickName, quickPhone);
      if (result.error || !result.client) {
        toast.error(result.error ?? "No pudimos crear la clienta.");
        return null;
      }
      setAddedClients((prev) => [result.client!, ...prev]);
      setClientId(result.client.id);
      // Tie the new client to this conversation so the chat starts showing
      // the proper name from now on.
      if (conversation) {
        void linkConversationClientAction(conversation.id, result.client.id);
      }
      toast.success("Clienta creada y vinculada.");
      return result.client.id;
    } finally {
      creatingClientRef.current = false;
      setCreatingClient(false);
    }
  }

  async function onSubmit() {
    if (selectedServiceIds.length === 0) {
      toast.error("Elegí al menos un servicio.");
      return;
    }
    if (!professionalId || !startsAt) {
      toast.error("Tocá un horario libre en la agenda.");
      return;
    }

    // If no client yet, create one on the fly from the quick form
    let cid = clientId;
    if (!cid) {
      const created = await handleQuickCreate();
      if (!created) return;
      cid = created;
    }

    const endsAtIso = new Date(
      new Date(startsAt).getTime() + totalDuration * 60 * 1000,
    ).toISOString();

    const formData = new FormData();
    formData.set("clientId", cid);
    formData.set("professionalId", professionalId);
    formData.set("startsAt", startsAt);
    formData.set("endsAt", endsAtIso);
    formData.set("status", "scheduled");
    formData.set("notes", notes);
    formData.set("serviceIds", selectedServiceIds.join(","));

    startTransition(async () => {
      const result = await createAppointmentAction(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (!result?.success) return;

      // Queue a WhatsApp confirmation in the same conversation. We do this
      // best-effort: a messaging failure shouldn't undo the booking.
      if (conversation) {
        const body = buildConfirmationMessage({
          startsAt,
          serviceNames: selectedServices.map((s) => s.name),
        });
        const msg = await sendMessageAction(conversation.id, body);
        if (msg.error) {
          toast.warning(`Turno creado, pero no pudimos enviar el aviso: ${msg.error}`);
        } else {
          toast.success("Turno creado y aviso enviado al chat.");
        }
      } else {
        toast.success("Turno creado.");
      }
      onOpenChange(false);
    });
  }

  const startLabel = startsAt
    ? format(new Date(startsAt), "EEE d 'de' MMM · HH:mm", { locale: es })
    : null;
  const endLabel =
    startsAt && totalDuration > 0
      ? format(
          new Date(new Date(startsAt).getTime() + totalDuration * 60 * 1000),
          "HH:mm",
          { locale: es },
        )
      : null;

  const selectedProfessional = professionals.find(
    (p) => p.id === professionalId,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[96vw] sm:max-w-none sm:w-[min(1280px,96vw)] max-h-[94dvh] p-3 sm:p-6"
      >
        <DialogHeader className="space-y-0.5">
          <DialogTitle className="text-base">Nuevo turno desde el chat</DialogTitle>
          <DialogDescription className="text-xs">
            Elegí profesional, horario y servicios. La duración la calculamos
            sumando los servicios.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] gap-3">
          {/* Slot picker: mini-agenda on desktop, plain selectors on mobile */}
          {isMobile ? (
            <div className="rounded-md border bg-card p-3 space-y-3 min-w-0">
              {resources.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center px-2 py-4">
                  Todavía no hay profesionales activas. Cargá al menos una en
                  «Profesionales» para poder agendar.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Profesional</Label>
                    <Select
                      value={professionalId}
                      onValueChange={setProfessionalId}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí profesional…" />
                      </SelectTrigger>
                      <SelectContent>
                        {professionals
                          .filter((p) => p.active)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="size-3 rounded-full border"
                                  style={{ backgroundColor: p.color }}
                                />
                                {p.full_name}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor="new-turno-when">
                      Día y hora
                    </Label>
                    <Input
                      id="new-turno-when"
                      type="datetime-local"
                      value={toLocalInput(startsAt)}
                      onChange={(e) =>
                        setStartsAt(
                          e.target.value ? fromLocalInput(e.target.value) : "",
                        )
                      }
                      step={1800}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-md border bg-card p-2 zenna-calendar zenna-mini-calendar min-w-0">
              {resources.length === 0 ? (
                <div className="flex items-center justify-center h-[460px] text-sm text-muted-foreground text-center px-4">
                  Todavía no hay profesionales activas. Cargá al menos una en
                  «Profesionales» para poder agendar.
                </div>
              ) : (
                <FullCalendar
                  plugins={[
                    resourceTimeGridPlugin,
                    timeGridPlugin,
                    interactionPlugin,
                  ]}
                  schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
                  locale={esLocale}
                  firstDay={1}
                  initialView="resourceTimeGridDay"
                  headerToolbar={{
                    left: "prev,next today",
                    center: "title",
                    right: "",
                  }}
                  titleFormat={{ day: "numeric", month: "short" }}
                  buttonText={{ today: "Hoy" }}
                  allDaySlot={false}
                  slotMinTime="08:00:00"
                  slotMaxTime="22:00:00"
                  slotDuration="00:30:00"
                  slotLabelInterval="01:00"
                  slotLabelFormat={{
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }}
                  eventTimeFormat={{
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }}
                  nowIndicator
                  selectable
                  selectMirror
                  editable={false}
                  eventDurationEditable={false}
                  longPressDelay={250}
                  selectLongPressDelay={250}
                  height={460}
                  expandRows
                  resources={resources}
                  events={events}
                  select={handleSelect}
                />
              )}
            </div>
          )}

          {/* Right column: client + services + summary + notes */}
          <div className="flex flex-col gap-3 min-w-0">
            {/* Client section */}
            <div className="space-y-1.5">
              <Label className="text-xs">Clienta</Label>
              {hasLinkedClient && effectiveClient ? (
                <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                  <div className="font-medium truncate">
                    {effectiveClient.full_name}
                  </div>
                  {effectiveClient.phone ? (
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {effectiveClient.phone}
                    </div>
                  ) : null}
                </div>
              ) : clientId && effectiveClient ? (
                <div className="rounded-md border bg-emerald-50 border-emerald-200 px-2.5 py-1.5 text-sm">
                  <div className="font-medium flex items-center gap-1.5 truncate">
                    <UserPlus className="size-3.5 text-emerald-700 shrink-0" />
                    {effectiveClient.full_name}
                  </div>
                  {effectiveClient.phone ? (
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {effectiveClient.phone}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2">
                  <Input
                    className="h-8"
                    placeholder="Nombre"
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                  />
                  <Input
                    className="h-8"
                    type="tel"
                    placeholder="Teléfono"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Services — compact grid, no internal scroll */}
            <div className="space-y-1.5">
              <Label className="text-xs">Servicios</Label>
              {services.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border p-3">
                  No hay servicios cargados.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {services.map((s) => {
                    const checked = selectedServiceIds.includes(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => toggleService(s.id)}
                        className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted/40 transition-colors ${checked ? "bg-foreground/5 border-foreground/40" : "bg-card"}`}
                      >
                        <Checkbox
                          checked={checked}
                          tabIndex={-1}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {s.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {formatDuration(s.duration_minutes)} ·{" "}
                            {formatCurrency(s.price)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="rounded-md border bg-muted/20 px-2.5 py-2 space-y-1 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="size-3" />
                <span className="font-medium">Resumen</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">
                  Profesional
                </span>
                <span className="font-medium truncate text-right">
                  {selectedProfessional ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: selectedProfessional.color }}
                      />
                      {selectedProfessional.full_name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">
                      Tocá la agenda
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Horario</span>
                <span className="font-medium tabular-nums text-right truncate">
                  {startLabel ? (
                    <>
                      {startLabel}
                      {endLabel ? (
                        <Badge
                          variant="outline"
                          className="ml-1 text-[10px] font-normal"
                        >
                          → {endLabel}
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Duración</span>
                <span className="font-medium tabular-nums">
                  {totalDuration > 0 ? formatDuration(totalDuration) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Total</span>
                <span className="font-semibold tabular-nums">
                  {totalPrice > 0 ? formatCurrency(totalPrice) : "—"}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label htmlFor="new-turno-notes" className="text-xs">
                Notas (opcional)
              </Label>
              <Textarea
                id="new-turno-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalles, fórmula, alergias…"
                className="text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={isPending || creatingClient}
          >
            {isPending || creatingClient ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Crear turno"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
