"use client";

import type {
  DateSelectArg,
  DatesSetArg,
  EventChangeArg,
  EventClickArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Users as UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Database } from "@/types/database.types";
import { moveAppointmentAction } from "./actions";
import {
  AppointmentDialog,
  type AppointmentDialogMode,
} from "./appointment-dialog";
import type {
  AppointmentWithRelations,
  ClientRow,
  ProfessionalRow,
  ServiceRow,
} from "./types";

type ServiceCategory = Database["public"]["Enums"]["service_category"];

type Props = {
  professionals: ProfessionalRow[];
  services: ServiceRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments: AppointmentWithRelations[];
};

/**
 * Paleta de la leyenda "TIPO DE SERVICIO". Son todos tostados de la misma
 * familia que el primario: en el referente la leyenda informa, no grita.
 */
const CATEGORY_META: Record<ServiceCategory, { label: string; color: string }> =
  {
    corte: { label: "Corte", color: "#6b4f3a" },
    color: { label: "Color", color: "#c1975c" },
    tratamiento: { label: "Tratamiento", color: "#a3856a" },
    manos: { label: "Manos", color: "#8c7b6b" },
    depilacion: { label: "Depilación", color: "#b08968" },
    make_up: { label: "Make up", color: "#9c6b4f" },
    peinado: { label: "Peinado", color: "#7b6a55" },
    otro: { label: "Otro", color: "#a8a29e" },
  };

function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString("es-AR")}`;
}

function appointmentTotal(a: AppointmentWithRelations): number {
  return a.appointment_services.reduce(
    (sum, line) => sum + (line.price_at_booking ?? 0),
    0,
  );
}

/** Los cancelados / no-show no suman ni al conteo ni a la facturación. */
function countsTowardTotals(a: AppointmentWithRelations): boolean {
  return a.status !== "cancelled" && a.status !== "no_show";
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function appointmentToEvent(
  a: AppointmentWithRelations,
  proColor: string,
): EventInput {
  const isCancelled = a.status === "cancelled";
  const isNoShow = a.status === "no_show";
  const isCompleted = a.status === "completed";

  const services = a.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");
  const title = `${a.clients?.full_name ?? "Sin clienta"}${services ? ` · ${services}` : ""}`;

  // Estrategia de color del referente: la tarjeta es gris neutro y el color
  // del profesional vive únicamente en la barra izquierda de 3px. Así la
  // agenda no se convierte en un arcoíris cuando hay varias columnas.
  const bg = isCancelled || isNoShow ? "#f6f5f3" : "#f1efec";
  const border = isCancelled || isNoShow ? "#c9c4bd" : proColor;

  const classes: string[] = [];
  if (isCancelled) classes.push("zenna-event-cancelled");
  if (isNoShow) classes.push("zenna-event-noshow");
  if (isCompleted) classes.push("zenna-event-completed");

  return {
    id: a.id,
    resourceId: a.professional_id,
    start: a.starts_at,
    end: a.ends_at,
    title,
    backgroundColor: bg,
    borderColor: border,
    textColor: "#211d19",
    classNames: classes,
    extendedProps: { status: a.status },
  };
}

export function CalendarView({
  professionals,
  services,
  clients,
  appointments,
}: Props) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AppointmentDialogMode | null>(
    null,
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [view, setView] = useState<"day" | "week">("day");

  // Rango visible que nos informa FullCalendar. Es la fuente de verdad del
  // título, de los totales y del resaltado del date-picker: así el toolbar
  // sigue en sincronía aunque se navegue con el teclado o arrastrando.
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);

  // Hydration-safe initial date. De paso fijamos el scroll inicial una hora
  // antes de "ahora", que es lo que hace que al abrir la agenda se vea el
  // bloque de turnos en curso y no las 8 de la mañana.
  const [initialDate, setInitialDate] = useState<string | undefined>();
  const [scrollTime, setScrollTime] = useState("09:00:00");
  useEffect(() => {
    const now = new Date();
    setInitialDate(now.toISOString());
    const hour = Math.min(21, Math.max(8, now.getHours() - 1));
    setScrollTime(`${String(hour).padStart(2, "0")}:00:00`);
  }, []);

  // Track viewport width so we can switch to a single-column day view on
  // mobile — ResourceTimeGrid with N professionals is unreadable below ~640px.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const activeProfessionals = useMemo(
    () => professionals.filter((p) => p.active),
    [professionals],
  );

  const proById = useMemo(
    () => new Map(professionals.map((p) => [p.id, p])),
    [professionals],
  );

  const events = useMemo(
    () =>
      appointments.map((a) =>
        appointmentToEvent(a, proById.get(a.professional_id)?.color ?? "#94a3b8"),
      ),
    [appointments, proById],
  );

  const resources = useMemo(
    () =>
      activeProfessionals.map((p) => ({
        id: p.id,
        title: p.full_name,
        eventBackgroundColor: p.color,
      })),
    [activeProfessionals],
  );

  // Turnos dentro del rango visible — alimentan el subtítulo del toolbar y
  // los contadores de cada columna de profesional.
  const visible = useMemo(() => {
    if (!range) return [] as AppointmentWithRelations[];
    const from = range.start.getTime();
    const to = range.end.getTime();
    return appointments.filter((a) => {
      const t = new Date(a.starts_at).getTime();
      return t >= from && t < to;
    });
  }, [appointments, range]);

  const totals = useMemo(() => {
    const counted = visible.filter(countsTowardTotals);
    return {
      count: counted.length,
      revenue: counted.reduce((sum, a) => sum + appointmentTotal(a), 0),
    };
  }, [visible]);

  const statsByPro = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const a of visible) {
      if (!countsTowardTotals(a)) continue;
      const current = map.get(a.professional_id) ?? { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += appointmentTotal(a);
      map.set(a.professional_id, current);
    }
    return map;
  }, [visible]);

  // Leyenda: una entrada por categoría de servicio efectivamente configurada.
  const legend = useMemo(() => {
    const present = new Set<ServiceCategory>();
    for (const s of services) {
      if (s.active) present.add(s.category);
    }
    return [...present].map((category) => ({
      category,
      ...CATEGORY_META[category],
    }));
  }, [services]);

  const title = useMemo(() => {
    if (!range) return "";
    if (view === "week") {
      const last = new Date(range.end.getTime() - 1);
      const sameMonth = last.getMonth() === range.start.getMonth();
      const left = sameMonth
        ? format(range.start, "d", { locale: es })
        : format(range.start, "d 'de' MMMM", { locale: es });
      return `${left} – ${format(last, "d 'de' MMMM", { locale: es })}`;
    }
    return capitalize(
      format(range.start, "EEEE, d 'de' MMMM", { locale: es }),
    );
  }, [range, view]);

  const dayViewName = isMobile ? "listDay" : "resourceTimeGridDay";

  const goto = useCallback((action: "prev" | "next" | "today") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (action === "prev") api.prev();
    else if (action === "next") api.next();
    else api.today();
  }, []);

  const changeView = useCallback(
    (next: "day" | "week") => {
      setView(next);
      calendarRef.current
        ?.getApi()
        .changeView(next === "week" ? "timeGridWeek" : dayViewName);
    },
    [dayViewName],
  );

  const pickDate = useCallback((date: Date | undefined) => {
    if (!date) return;
    calendarRef.current?.getApi().gotoDate(date);
    setDatePickerOpen(false);
  }, []);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setRange({ start: arg.start, end: arg.end });
  }, []);

  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      const resourceId =
        arg.resource?.id ?? activeProfessionals[0]?.id ?? null;
      if (!resourceId) {
        toast.error(
          "Cargá al menos una profesional activa antes de crear turnos.",
        );
        arg.view.calendar.unselect();
        return;
      }
      setDialogMode({
        type: "create",
        professionalId: resourceId,
        startsAt: arg.start.toISOString(),
      });
      setDialogOpen(true);
      arg.view.calendar.unselect();
    },
    [activeProfessionals],
  );

  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const found = appointments.find((a) => a.id === arg.event.id);
      if (!found) {
        toast.error("No pudimos cargar el turno.");
        return;
      }
      setDialogMode({ type: "edit", appointment: found });
      setDialogOpen(true);
    },
    [appointments],
  );

  // Inject a small "+" button into each turno on the desktop time-grid so the
  // salon can add a SECOND turno at the exact same time/professional with one
  // click. Tapping the body of a turno still opens it (eventClick); the "+"
  // stops propagation and opens the create dialog pre-filled instead. We do
  // this on mount (rather than via eventContent) to leave FullCalendar's
  // default time/title rendering — and the cancelled/completed styles —
  // completely untouched.
  const handleEventDidMount = useCallback(
    (arg: EventMountArg) => {
      if (isMobile) return;
      if (arg.view.type === "listDay") return;

      const resourceId = arg.event.getResources()[0]?.id;
      const start = arg.event.start;
      if (!resourceId || !start) return;
      const startsAtIso = start.toISOString();

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zenna-event-add";
      btn.textContent = "+";
      btn.title = "Agregar otro turno a esta hora";
      btn.setAttribute("aria-label", "Agregar otro turno a esta hora");
      // Stop the gestures FullCalendar binds on the event (drag-to-move on
      // mousedown, open-turno on click) so the button does its own thing.
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        setDialogMode({
          type: "create",
          professionalId: resourceId,
          startsAt: startsAtIso,
        });
        setDialogOpen(true);
      });
      arg.el.appendChild(btn);
    },
    [isMobile],
  );

  const handleEventChange = useCallback(
    async (arg: EventChangeArg) => {
      const start = arg.event.start;
      const end = arg.event.end ?? arg.event.start;
      if (!start || !end) {
        arg.revert();
        return;
      }

      // Detect resource (column) change → drag across professionals
      const newResourceId =
        arg.event.getResources()[0]?.id ?? arg.oldEvent.getResources()[0]?.id;

      const formData = new FormData();
      formData.set("startsAt", start.toISOString());
      formData.set("endsAt", end.toISOString());
      if (newResourceId) formData.set("professionalId", newResourceId);

      const result = await moveAppointmentAction(arg.event.id, formData);
      if (result.error) {
        toast.error(result.error);
        arg.revert();
      } else {
        toast.success("Turno reubicado.");
        router.refresh();
      }
    },
    [router],
  );

  function onDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setDialogMode(null);
      router.refresh();
    }
  }

  // Abre el diálogo de alta con la próxima media hora redonda como default.
  const openCreate = useCallback(() => {
    const firstPro = activeProfessionals[0];
    if (!firstPro) {
      toast.error(
        "Cargá al menos una profesional activa antes de crear turnos.",
      );
      return;
    }
    const base = range?.start ? new Date(range.start) : new Date();
    const now = new Date();
    // Si el día visible es otro, arrancamos a las 10:00 de ese día.
    const isToday = base.toDateString() === now.toDateString();
    const startsAt = isToday ? now : new Date(base);
    if (isToday) {
      startsAt.setSeconds(0, 0);
      const minutes = startsAt.getMinutes();
      const add =
        minutes === 0 || minutes === 30
          ? 0
          : minutes < 30
            ? 30 - minutes
            : 60 - minutes;
      startsAt.setMinutes(minutes + add);
    } else {
      startsAt.setHours(10, 0, 0, 0);
    }

    setDialogMode({
      type: "create",
      professionalId: firstPro.id,
      startsAt: startsAt.toISOString(),
    });
    setDialogOpen(true);
  }, [activeProfessionals, range]);

  // Atajos del referente: N nuevo · T hoy · ← → días.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (dialogOpen || datePickerOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      // Cualquier diálogo/popover abierto se queda con el teclado.
      if (document.querySelector("[data-slot='dialog-content']")) return;

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          openCreate();
          break;
        case "t":
        case "T":
          e.preventDefault();
          goto("today");
          break;
        case "ArrowLeft":
          e.preventDefault();
          goto("prev");
          break;
        case "ArrowRight":
          e.preventDefault();
          goto("next");
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, datePickerOpen, goto, openCreate]);

  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 py-16 text-center">
        <p className="text-base font-medium">Todavía no hay profesionales</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Cargá al menos una profesional activa con su horario semanal en el
          menú &ldquo;Profesionales&rdquo; para que aparezca como columna acá.
        </p>
      </div>
    );
  }

  return (
    <div data-bleed className="flex h-full min-h-0 flex-col bg-card">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        {/* ‹ Hoy › */}
        <div className="inline-flex items-center rounded-lg border border-input bg-card">
          <button
            type="button"
            onClick={() => goto("prev")}
            aria-label="Día anterior"
            className="flex h-9 w-8 items-center justify-center rounded-l-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => goto("today")}
            className="h-9 border-x border-input px-4 text-sm font-medium hover:bg-muted"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => goto("next")}
            aria-label="Día siguiente"
            className="flex h-9 w-8 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              Fecha
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={es}
              weekStartsOn={1}
              selected={range?.start}
              defaultMonth={range?.start}
              onSelect={pickDate}
            />
          </PopoverContent>
        </Popover>

        <div className="segmented">
          <button
            type="button"
            data-active={view === "day"}
            onClick={() => changeView("day")}
            className="segmented-item"
          >
            Día
          </button>
          <button
            type="button"
            data-active={view === "week"}
            onClick={() => changeView("week")}
            className="segmented-item"
          >
            Semana
          </button>
        </div>

        <div className="min-w-0 leading-tight">
          <div className="truncate text-[1.0625rem] font-medium text-foreground">
            {title}
          </div>
          <div className="text-[0.8125rem] text-muted-foreground tabular-nums">
            {totals.count} {totals.count === 1 ? "turno" : "turnos"} ·{" "}
            {money(totals.revenue)}
          </div>
        </div>

        <div className="hidden items-center gap-1.5 text-[0.8125rem] text-muted-foreground xl:flex">
          <kbd className="kbd">N</kbd>
          <span>nuevo</span>
          <span className="text-border">·</span>
          <kbd className="kbd">T</kbd>
          <span>hoy</span>
          <span className="text-border">·</span>
          <kbd className="kbd">←</kbd>
          <kbd className="kbd">→</kbd>
          <span>días</span>
        </div>

        <Button
          type="button"
          size="lg"
          onClick={openCreate}
          className="ml-auto gap-2"
        >
          <Plus className="size-4" />
          Nuevo turno
        </Button>
      </div>

      {/* ── Leyenda de tipos de servicio ────────────────────────────── */}
      {legend.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 pb-3 sm:px-6">
          <span className="section-label">Tipo de servicio</span>
          {legend.map((entry) => (
            <span
              key={entry.category}
              className="inline-flex items-center gap-2 text-[0.8125rem] text-foreground"
            >
              <span
                aria-hidden
                className="size-2.5 rounded-[3px]"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── Agenda ──────────────────────────────────────────────────── */}
      <div className="zenna-calendar min-h-0 flex-1 overflow-y-auto px-2 pb-6 sm:px-4">
        <FullCalendar
          ref={calendarRef}
          // Force a remount when switching between mobile/desktop so that
          // `initialView` actually changes — FullCalendar caches the view at
          // mount and won't switch live otherwise.
          key={isMobile ? "mobile" : "desktop"}
          plugins={[
            resourceTimeGridPlugin,
            timeGridPlugin,
            interactionPlugin,
            listPlugin,
          ]}
          schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
          locale={esLocale}
          firstDay={1}
          // El toolbar es nuestro: FullCalendar solo dibuja la grilla.
          headerToolbar={false}
          initialView={view === "week" ? "timeGridWeek" : dayViewName}
          initialDate={initialDate}
          datesSet={handleDatesSet}
          noEventsContent={
            isMobile
              ? "No hay turnos para este día. Tocá «Nuevo turno» arriba para agendar."
              : "No hay turnos para este día."
          }
          allDaySlot={false}
          slotMinTime="08:00:00"
          slotMaxTime="22:00:00"
          slotDuration={isMobile ? "01:00:00" : "00:30:00"}
          slotLabelInterval="01:00"
          scrollTime={scrollTime}
          slotLabelFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          // "01:00 p. m. → 01:45 p. m." — el formato exacto del referente.
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }}
          displayEventEnd
          defaultRangeSeparator=" → "
          nowIndicator
          editable={!isMobile}
          selectable={!isMobile}
          selectMirror
          eventDurationEditable={!isMobile}
          longPressDelay={250}
          selectLongPressDelay={250}
          height="auto"
          expandRows
          // Allow more than one turno in the same time slot. With overlap
          // disabled, simultaneous turnos for the same pro render as clean
          // side-by-side columns instead of stacking on top of each other.
          slotEventOverlap={false}
          resources={resources}
          resourceLabelContent={(arg) => {
            const pro = proById.get(arg.resource.id);
            const stats = statsByPro.get(arg.resource.id);
            return (
              <div className="flex items-center gap-2.5 px-1 py-1 text-left">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold text-white"
                  style={{ backgroundColor: pro?.color ?? "#94a3b8" }}
                >
                  {initialOf(pro?.full_name ?? arg.resource.title)}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[0.9375rem] font-medium text-foreground">
                    {pro?.full_name ?? arg.resource.title}
                  </span>
                  <span className="flex items-center gap-2.5 text-xs font-normal text-muted-foreground tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <UsersIcon className="size-3" />
                      {stats?.count ?? 0}
                    </span>
                    <span>{money(stats?.revenue ?? 0)}</span>
                  </span>
                </span>
              </div>
            );
          }}
          events={events}
          select={handleSelect}
          eventClick={handleEventClick}
          eventChange={handleEventChange}
          eventDidMount={handleEventDidMount}
        />
      </div>

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={onDialogChange}
        mode={dialogMode}
        professionals={professionals}
        services={services}
        clients={clients}
        appointments={appointments}
      />
    </div>
  );
}
