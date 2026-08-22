"use client";

import type {
  DateSelectArg,
  EventInput,
} from "@fullcalendar/core";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, Loader2, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
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
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";
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

function toDateInput(iso: string): string {
  if (!iso) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/*
 * La mini-agenda comparte el módulo de la grilla con /turnos, y se baja recién
 * cuando este diálogo la va a dibujar: en el teléfono nunca —abajo de 640px se
 * reemplaza por un select de profesional y un campo de fecha y hora— y en el
 * escritorio recién al abrir "Nuevo turno". Sin esto, todo `@fullcalendar/*`
 * viajaba dentro del chunk de la bandeja y lo pagaba cada apertura del chat.
 */
const FcGrid = dynamic(
  () => import("../turnos/fc-grid").then((m) => m.FcGrid),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[460px] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 30;

type DaySlot = {
  iso: string;
  label: string;
  taken: boolean;
  busyWith?: string;
};

/**
 * Build the 30-min slot grid for a (date, pro) pair and mark taken slots
 * using the existing appointment intervals. Cancelled / no-show turnos
 * free up the slot. The "now" cutoff hides past slots when picking today.
 */
function buildDaySlots(
  dateStr: string,
  proId: string,
  appointments: AppointmentWithRelations[],
): DaySlot[] {
  if (!dateStr || !proId) return [];
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return [];
  const dayStart = new Date(y, m - 1, d, OPEN_HOUR, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, CLOSE_HOUR, 0, 0, 0);
  const now = new Date();

  const busy = appointments
    .filter(
      (a) =>
        a.professional_id === proId &&
        a.status !== "cancelled" &&
        a.status !== "no_show",
    )
    .map((a) => ({
      start: new Date(a.starts_at).getTime(),
      end: new Date(a.ends_at).getTime(),
      title: a.clients?.full_name ?? "Ocupado",
    }));

  const slots: DaySlot[] = [];
  for (
    let t = dayStart.getTime();
    t < dayEnd.getTime();
    t += SLOT_MINUTES * 60 * 1000
  ) {
    const slotStart = t;
    const slotEnd = t + SLOT_MINUTES * 60 * 1000;
    if (slotEnd <= now.getTime()) continue;
    const overlap = busy.find(
      (b) => b.start < slotEnd && b.end > slotStart,
    );
    const dt = new Date(slotStart);
    const pad = (n: number) => String(n).padStart(2, "0");
    slots.push({
      iso: dt.toISOString(),
      label: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      taken: !!overlap,
      busyWith: overlap?.title,
    });
  }
  return slots;
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
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>("cash");
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

  // Reset every time the dialog opens for a (possibly different) conversation.
  // IMPORTANT: depend on the conversation *id*, not the conversation object —
  // the parent re-renders on every CRM realtime/poll tick with a new object
  // reference for the same conversation, which would otherwise wipe the user's
  // selections (pro, slot, services) mid-flow.
  const conversationId = conversation?.id ?? null;
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
    setDepositAmount(0);
    setDepositMethod("cash");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

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
    formData.set("depositAmount", String(depositAmount > 0 ? depositAmount : 0));
    formData.set("depositMethod", depositAmount > 0 ? depositMethod : "");

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
            <MobileSlotPicker
              resources={resources}
              professionals={professionals}
              professionalId={professionalId}
              setProfessionalId={setProfessionalId}
              startsAt={startsAt}
              setStartsAt={setStartsAt}
              appointments={appointments}
            />
          ) : (
            <div className="rounded-md border bg-card p-2 zenna-calendar zenna-mini-calendar min-w-0">
              {resources.length === 0 ? (
                <div className="flex items-center justify-center h-[460px] text-sm text-muted-foreground text-center px-4">
                  Todavía no hay profesionales activas. Cargá al menos una en
                  «Profesionales» para poder agendar.
                </div>
              ) : (
                <FcGrid
                  schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
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
                  // Render simultaneous turnos side by side instead of stacked.
                  slotEventOverlap={false}
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

            {/* Seña / adelanto (opcional) */}
            <div className="space-y-1">
              <Label htmlFor="new-turno-deposit" className="text-xs">
                Seña / adelanto (opcional)
              </Label>
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <Input
                  id="new-turno-deposit"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={500}
                  value={depositAmount || ""}
                  placeholder="0"
                  onChange={(e) =>
                    setDepositAmount(Number(e.target.value) || 0)
                  }
                  className="text-right tabular-nums text-sm"
                />
                <Select
                  value={depositMethod}
                  onValueChange={(v) => setDepositMethod(v as PaymentMethod)}
                  disabled={depositAmount <= 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Método" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {depositAmount > 0 && totalPrice > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Saldo a cobrar:{" "}
                  <strong className="text-foreground">
                    {formatCurrency(Math.max(0, totalPrice - depositAmount))}
                  </strong>
                </p>
              ) : null}
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

function MobileSlotPicker({
  resources,
  professionals,
  professionalId,
  setProfessionalId,
  startsAt,
  setStartsAt,
  appointments,
}: {
  resources: { id: string }[];
  professionals: ProfessionalRow[];
  professionalId: string;
  setProfessionalId: (id: string) => void;
  startsAt: string;
  setStartsAt: (iso: string) => void;
  appointments: AppointmentWithRelations[];
}) {
  // The picker has its own day cursor so the user can browse availability
  // without losing their slot selection on the other field.
  const [pickedDate, setPickedDate] = useState<string>(() =>
    toDateInput(startsAt || ""),
  );

  // Keep pickedDate in sync if startsAt changes (e.g. dialog reset).
  useEffect(() => {
    if (startsAt) setPickedDate(toDateInput(startsAt));
  }, [startsAt]);

  const slots = useMemo(
    () => buildDaySlots(pickedDate, professionalId, appointments),
    [pickedDate, professionalId, appointments],
  );

  if (resources.length === 0) {
    return (
      <div className="rounded-md border bg-card p-3 min-w-0">
        <p className="text-sm text-muted-foreground text-center px-2 py-4">
          Todavía no hay profesionales activas. Cargá al menos una en
          «Profesionales» para poder agendar.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-3 space-y-3 min-w-0">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Profesional</Label>
          <Select value={professionalId} onValueChange={setProfessionalId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegí…" />
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
          <Label className="text-xs" htmlFor="new-turno-day">
            Día
          </Label>
          <Input
            id="new-turno-day"
            type="date"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Horario disponible</Label>
          {slots.some((s) => s.taken) ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
              <span className="size-1.5 rounded-full bg-amber-500" />
              ya tiene turno
            </span>
          ) : null}
        </div>
        {!professionalId ? (
          <p className="text-xs text-muted-foreground italic px-1">
            Elegí una profesional para ver los horarios.
          </p>
        ) : slots.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            No hay horarios disponibles para este día.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 max-h-[280px] overflow-y-auto pr-1">
            {slots.map((s) => {
              const isPicked = s.iso === startsAt;
              return (
                <button
                  type="button"
                  key={s.iso}
                  // Taken slots stay selectable to allow more than one turno
                  // at the same time. The amber dot just flags an existing one.
                  onClick={() => setStartsAt(s.iso)}
                  title={
                    s.taken
                      ? `Ya hay un turno (${s.busyWith}) · tocá para agregar otro`
                      : undefined
                  }
                  className={`relative rounded-md border px-2 py-2 text-sm tabular-nums transition-colors ${
                    isPicked
                      ? "bg-foreground text-background border-foreground font-semibold"
                      : s.taken
                        ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                        : "bg-card hover:bg-muted/40"
                  }`}
                >
                  {s.label}
                  {s.taken && !isPicked ? (
                    <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
