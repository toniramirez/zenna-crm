"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_STATUSES,
  STATUS_LABEL,
  type AppointmentStatus,
} from "@/lib/validations/appointments";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { CATEGORY_LABEL } from "@/lib/validations/services";
import {
  createClientQuickAction,
  type QuickClient,
} from "../clientas/actions";
import {
  cancelAppointmentAction,
  createAppointmentAction,
  updateAppointmentAction,
} from "./actions";
import type {
  AppointmentWithRelations,
  ClientRow,
  ProfessionalRow,
  ServiceRow,
} from "./types";

export type AppointmentDialogMode =
  | { type: "create"; professionalId: string; startsAt: string }
  | { type: "edit"; appointment: AppointmentWithRelations };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AppointmentDialogMode | null;
  professionals: ProfessionalRow[];
  services: ServiceRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  // Used by the mobile slot picker to mark busy 30-min slots per pro/day.
  // Optional so the dialog still renders when callers haven't supplied it.
  appointments?: AppointmentWithRelations[];
  /**
   * Abre el WhatsApp de la clienta del turno. Opcional: sólo tiene sentido
   * editando un turno que ya existe.
   */
  onMessageClient?: (appointment: AppointmentWithRelations) => void;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function localDatePart(local: string): string {
  // "2026-05-11T15:00" -> "2026-05-11"  (or today's date if empty)
  if (local && local.length >= 10) return local.slice(0, 10);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 30;

type DaySlot = {
  iso: string;
  local: string;
  label: string;
  taken: boolean;
  busyWith?: string;
};

function buildDaySlots(
  dateStr: string,
  proId: string,
  appointments: AppointmentWithRelations[],
  editingAppointmentId?: string,
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
        a.status !== "no_show" &&
        // When editing, ignore the appointment itself so the user can re-pick
        // its current slot without it being marked as "taken".
        a.id !== editingAppointmentId,
    )
    .map((a) => ({
      start: new Date(a.starts_at).getTime(),
      end: new Date(a.ends_at).getTime(),
      title: a.clients?.full_name ?? "Ocupado",
    }));

  const slots: DaySlot[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
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
    slots.push({
      iso: dt.toISOString(),
      local: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      label: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      taken: !!overlap,
      busyWith: overlap?.title,
    });
  }
  return slots;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  mode,
  professionals,
  services,
  clients,
  appointments = [],
  onMessageClient,
}: Props) {
  const editing = mode?.type === "edit";

  // Mobile detection — datetime-local is clunky on phones and doesn't show
  // which slots are already taken. On mobile we swap it for a date input +
  // slot grid with busy slots disabled.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const [pickedDate, setPickedDate] = useState<string>("");

  const [clientId, setClientId] = useState<string>("");
  const [professionalId, setProfessionalId] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>("");
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");
  const [notes, setNotes] = useState("");
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>("cash");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [servicesPickerOpen, setServicesPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Quick-create client state. addedClients lets the just-created walk-ins
  // appear in the picker without a page refresh.
  const [clientMode, setClientMode] = useState<"pick" | "create">("pick");
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [addedClients, setAddedClients] = useState<QuickClient[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  // Synchronous guard — `setCreatingClient` is async, so without this a fast
  // double-click on "Crear y usar" can fire the server action twice before
  // React re-renders and disables the button.
  const creatingClientRef = useRef(false);

  // Reset when mode changes
  useEffect(() => {
    if (!open || !mode) return;
    if (mode.type === "create") {
      setClientId("");
      setProfessionalId(mode.professionalId);
      const local = toLocalInput(mode.startsAt);
      setStartsAt(local);
      setPickedDate(localDatePart(local));
      setStatus("scheduled");
      setNotes("");
      setDepositAmount(0);
      setDepositMethod("cash");
      setSelectedServiceIds([]);
    } else {
      const a = mode.appointment;
      const local = toLocalInput(a.starts_at);
      setClientId(a.clients?.id ?? "");
      setProfessionalId(a.professional_id);
      setStartsAt(local);
      setPickedDate(localDatePart(local));
      setStatus(a.status);
      setNotes(a.notes ?? "");
      setDepositAmount(Number(a.deposit_amount ?? 0));
      setDepositMethod((a.deposit_method as PaymentMethod) ?? "cash");
      setSelectedServiceIds(
        a.appointment_services
          .map((s) => s.services?.id)
          .filter((id): id is string => !!id),
      );
    }
    setClientMode("pick");
    setQuickName("");
    setQuickPhone("");
    setClientSearch("");
  }, [open, mode]);

  // Mobile slot grid for the current (date, pro) pair
  const editingId = mode?.type === "edit" ? mode.appointment.id : undefined;
  const daySlots = useMemo(
    () => buildDaySlots(pickedDate, professionalId, appointments, editingId),
    [pickedDate, professionalId, appointments, editingId],
  );

  // Combined client list: any walk-ins created in this dialog first, then the server-loaded list
  const allClients = useMemo<QuickClient[]>(
    () => [...addedClients, ...clients],
    [addedClients, clients],
  );

  // Totals
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

  // Always-auto end time, computed from start + total duration
  const endsAt = useMemo(() => {
    if (!startsAt || totalDuration === 0) return "";
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + totalDuration * 60 * 1000);
    return toLocalInput(end.toISOString());
  }, [startsAt, totalDuration]);

  const endLabel = useMemo(() => {
    if (!endsAt) return null;
    try {
      return format(new Date(endsAt), "HH:mm", { locale: es });
    } catch {
      return null;
    }
  }, [endsAt]);

  function toggleService(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function startQuickCreate() {
    setQuickName(clientSearch.trim());
    setQuickPhone("");
    setClientMode("create");
    setClientPickerOpen(false);
  }

  function cancelQuickCreate() {
    setClientMode("pick");
    setQuickName("");
    setQuickPhone("");
  }

  function handleQuickCreate() {
    if (creatingClientRef.current) return;
    if (quickName.trim().length < 2) {
      toast.error("El nombre es muy corto.");
      return;
    }
    creatingClientRef.current = true;
    setCreatingClient(true);
    (async () => {
      try {
        const result = await createClientQuickAction(quickName, quickPhone);
        if (result.error || !result.client) {
          toast.error(result.error ?? "No pudimos crear la clienta.");
          return;
        }
        setAddedClients((prev) => [result.client!, ...prev]);
        setClientId(result.client.id);
        setClientMode("pick");
        setQuickName("");
        setQuickPhone("");
        toast.success("Clienta creada y seleccionada.");
      } finally {
        creatingClientRef.current = false;
        setCreatingClient(false);
      }
    })();
  }

  function onSubmit() {
    if (!clientId) {
      toast.error("Falta seleccionar la clienta.");
      return;
    }
    if (selectedServiceIds.length === 0) {
      toast.error("Elegí al menos un servicio.");
      return;
    }
    if (!startsAt || !endsAt) {
      toast.error("Falta el horario.");
      return;
    }

    const formData = new FormData();
    formData.set("clientId", clientId);
    formData.set("professionalId", professionalId);
    formData.set("startsAt", fromLocalInput(startsAt));
    formData.set("endsAt", fromLocalInput(endsAt));
    formData.set("status", status);
    formData.set("notes", notes);
    formData.set("serviceIds", selectedServiceIds.join(","));
    formData.set("depositAmount", String(depositAmount > 0 ? depositAmount : 0));
    formData.set("depositMethod", depositAmount > 0 ? depositMethod : "");

    startTransition(async () => {
      const result =
        editing && mode?.type === "edit"
          ? await updateAppointmentAction(mode.appointment.id, formData)
          : await createAppointmentAction(formData);

      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success(editing ? "Turno actualizado." : "Turno creado.");
        onOpenChange(false);
      }
    });
  }

  function onCancelTurno() {
    if (!editing || mode?.type !== "edit") return;
    startTransition(async () => {
      const result = await cancelAppointmentAction(mode.appointment.id);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Turno cancelado.");
        onOpenChange(false);
      }
    });
  }

  const selectedClient = allClients.find((c) => c.id === clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar turno" : "Nuevo turno"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Cambiá servicios, horario o estado del turno."
              : "Cargá clienta, servicios y profesional. La duración la calculamos sumando los servicios."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Client picker — combobox OR quick-create inline form */}
          <div className="space-y-2">
            <Label>Clienta</Label>
            {clientMode === "pick" ? (
              <Popover
                open={clientPickerOpen}
                onOpenChange={setClientPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {selectedClient ? (
                      <span className="truncate">
                        {selectedClient.full_name}
                        {selectedClient.phone ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {selectedClient.phone}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Buscá una clienta…
                      </span>
                    )}
                    <ChevronsUpDown className="size-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput
                      placeholder="Nombre o teléfono…"
                      value={clientSearch}
                      onValueChange={setClientSearch}
                    />
                    <CommandList>
                      <CommandEmpty className="py-3 px-2">
                        <button
                          type="button"
                          onClick={startQuickCreate}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
                        >
                          <UserPlus className="size-4 text-gold" />
                          <span>
                            Crear nueva
                            {clientSearch.trim() ? (
                              <strong className="ml-1">
                                «{clientSearch.trim()}»
                              </strong>
                            ) : (
                              " clienta"
                            )}
                          </span>
                        </button>
                      </CommandEmpty>
                      <CommandGroup>
                        {allClients.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.full_name} ${c.phone ?? ""}`}
                            onSelect={() => {
                              setClientId(c.id);
                              setClientPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "size-4",
                                clientId === c.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{c.full_name}</span>
                              {c.phone ? (
                                <span className="text-xs text-muted-foreground">
                                  {c.phone}
                                </span>
                              ) : null}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <div className="border-t p-1">
                        <button
                          type="button"
                          onClick={startQuickCreate}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
                        >
                          <UserPlus className="size-4 text-gold" />
                          <span>Crear nueva clienta</span>
                        </button>
                      </div>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Nueva clienta</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelQuickCreate}
                    disabled={creatingClient}
                  >
                    Cancelar
                  </Button>
                </div>
                <Input
                  placeholder="Nombre completo"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  autoFocus
                />
                <Input
                  type="tel"
                  placeholder="Teléfono (opcional)"
                  value={quickPhone}
                  onChange={(e) => setQuickPhone(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleQuickCreate}
                  disabled={creatingClient}
                >
                  {creatingClient ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Creando…
                    </>
                  ) : (
                    <>
                      <Plus className="size-4" />
                      Crear y usar
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Professional + status */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Profesional</Label>
              <Select
                value={professionalId}
                onValueChange={setProfessionalId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegí…" />
                </SelectTrigger>
                <SelectContent>
                  {professionals.map((p) => (
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
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as AppointmentStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Services — collapsible Popover */}
          <div className="space-y-2">
            <Label>Servicios</Label>
            <Popover
              open={servicesPickerOpen}
              onOpenChange={setServicesPickerOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal h-auto py-2"
                >
                  {selectedServices.length === 0 ? (
                    <span className="text-muted-foreground">
                      Elegí al menos un servicio
                    </span>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5 min-w-0">
                      <span className="truncate text-left">
                        {selectedServices.map((s) => s.name).join(" + ")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {selectedServices.length}{" "}
                        {selectedServices.length === 1
                          ? "servicio"
                          : "servicios"}{" "}
                        · {formatDuration(totalDuration)} ·{" "}
                        {formatCurrency(totalPrice)}
                      </span>
                    </div>
                  )}
                  <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                // Cap the popover to the space actually available between the
                // trigger and the screen edge so the full list is reachable on
                // mobile (a fixed max-height used to push the bottom services
                // off-screen, making it look like only some services existed).
                className="w-[var(--radix-popover-trigger-width)] p-0 flex flex-col max-h-[min(20rem,var(--radix-popover-content-available-height))]"
                align="start"
              >
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {services.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No hay servicios cargados. Andá a Servicios para crear
                      los primeros.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {services.map((s) => {
                        const checked = selectedServiceIds.includes(s.id);
                        return (
                          <li
                            key={s.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                            onClick={() => toggleService(s.id)}
                          >
                            <Checkbox checked={checked} tabIndex={-1} />
                            <div className="flex-1 min-w-0 flex flex-col">
                              <span className="text-sm font-medium truncate">
                                {s.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {CATEGORY_LABEL[s.category]} ·{" "}
                                {formatDuration(s.duration_minutes)} ·{" "}
                                {formatCurrency(s.price)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {selectedServices.length > 0 ? (
                  <div className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between bg-muted/20">
                    <span>
                      {selectedServices.length} seleccionado
                      {selectedServices.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      {formatDuration(totalDuration)} ·{" "}
                      <strong className="text-foreground">
                        {formatCurrency(totalPrice)}
                      </strong>
                    </span>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>

          {/* Inicio — datetime-local on desktop, date + slot grid on mobile */}
          {isMobile ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="picked-date" className="text-xs">
                    Día
                  </Label>
                  <Input
                    id="picked-date"
                    type="date"
                    value={pickedDate}
                    onChange={(e) => {
                      setPickedDate(e.target.value);
                      // Clear the start time when changing day — the user
                      // needs to pick a slot below.
                      setStartsAt("");
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Inicio elegido</Label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm tabular-nums h-9 flex items-center">
                    {startsAt ? (
                      startsAt.slice(11, 16)
                    ) : (
                      <span className="text-muted-foreground italic text-xs">
                        Elegí un horario ↓
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Horarios del día</Label>
                  {daySlots.some((s) => s.taken) ? (
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
                ) : daySlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic px-1">
                    No hay horarios disponibles para este día.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                    {daySlots.map((s) => {
                      const isPicked = s.local === startsAt;
                      return (
                        <button
                          type="button"
                          key={s.local}
                          // Taken slots stay selectable so the salon can book
                          // more than one turno at the same time. The amber
                          // dot just flags that there's already a turno there.
                          onClick={() => setStartsAt(s.local)}
                          title={
                            s.taken
                              ? `Ya hay un turno (${s.busyWith}) · tocá para agregar otro`
                              : undefined
                          }
                          className={cn(
                            "relative rounded-md border px-2 py-2 text-sm tabular-nums transition-colors",
                            isPicked
                              ? "bg-foreground text-background border-foreground font-semibold"
                              : s.taken
                                ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                                : "bg-card hover:bg-muted/40",
                          )}
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

              {endsAt && endLabel && totalDuration > 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    Termina a las {endLabel}
                  </Badge>
                  <span>{formatDuration(totalDuration)} en total</span>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="starts-at">Inicio</Label>
              <Input
                id="starts-at"
                type="datetime-local"
                step={900}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
              {endsAt && endLabel && totalDuration > 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    Termina a las {endLabel}
                  </Badge>
                  <span>{formatDuration(totalDuration)} en total</span>
                </p>
              ) : null}
            </div>
          )}

          {/* Seña / adelanto (opcional) */}
          <div className="space-y-2">
            <Label htmlFor="deposit-amount">Seña / adelanto (opcional)</Label>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <Input
                id="deposit-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step={500}
                value={depositAmount || ""}
                placeholder="0"
                onChange={(e) =>
                  setDepositAmount(Number(e.target.value) || 0)
                }
                className="text-right tabular-nums"
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
                Saldo a cobrar en el turno:{" "}
                <strong className="text-foreground">
                  {formatCurrency(Math.max(0, totalPrice - depositAmount))}
                </strong>{" "}
                · la seña se registra como ingreso al cobrar.
              </p>
            ) : null}
          </div>

          {/* Notas */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles, fórmula a usar, alergias…"
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          {editing ? (
            <div className="flex flex-col-reverse gap-2 sm:mr-auto sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onCancelTurno}
                disabled={isPending}
              >
                <Trash2 className="size-4" />
                Cancelar turno
              </Button>
              {onMessageClient && mode?.type === "edit" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onMessageClient(mode.appointment)}
                  disabled={isPending}
                >
                  <MessageCircle className="size-4" />
                  WhatsApp
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2 sm:ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
            <Button onClick={onSubmit} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Guardando…
                </>
              ) : editing ? (
                "Guardar cambios"
              ) : (
                "Crear turno"
              )}
            </Button>
          </div>
        </DialogFooter>
        {editing && mode?.type === "edit" ? (
          <p className="text-xs text-muted-foreground">
            Estado actual:{" "}
            <strong>{STATUS_LABEL[mode.appointment.status]}</strong>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
