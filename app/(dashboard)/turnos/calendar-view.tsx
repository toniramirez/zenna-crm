"use client";

import type {
  DateSelectArg,
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
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

type Props = {
  professionals: ProfessionalRow[];
  services: ServiceRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments: AppointmentWithRelations[];
};

/**
 * Convert a #RRGGBB hex color to an `rgba(...)` string at the given alpha.
 * Used to derive a soft tinted background from each professional's color.
 */
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
  const isCompleted = a.status === "completed";

  const services = a.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");
  const title = `${a.clients?.full_name ?? "Sin clienta"}${services ? ` · ${services}` : ""}`;

  // Color strategy:
  //   - background = soft tint of the pro's color (clear visual ID)
  //   - border (3px left stripe) = full pro color
  //   - cancelled/no-show = neutral grey + struck through, so the cancelled
  //     state stays unmistakable across views
  const bg = isCancelled || isNoShow ? "rgba(120,113,108,0.10)" : hexToRgba(proColor, 0.18);
  const border = isCancelled || isNoShow ? "#a8a29e" : proColor;

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
    textColor: "#1c1917",
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AppointmentDialogMode | null>(
    null,
  );

  // Hydration-safe initial date
  const [initialDate, setInitialDate] = useState<string | undefined>();
  useEffect(() => {
    setInitialDate(new Date().toISOString());
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

  const proColorById = useMemo(
    () => new Map(professionals.map((p) => [p.id, p.color])),
    [professionals],
  );

  const events = useMemo(
    () =>
      appointments.map((a) =>
        appointmentToEvent(a, proColorById.get(a.professional_id) ?? "#94a3b8"),
      ),
    [appointments, proColorById],
  );

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

  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      const resourceId =
        arg.resource?.id ??
        professionals.find((p) => p.active)?.id ??
        null;
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
    [professionals],
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

  // Mobile "Nuevo turno" entry point — tap-to-create on the list view isn't a
  // FullCalendar feature, so we offer an explicit button that opens the
  // dialog with the next round half-hour as a sensible default.
  function openCreateFromButton() {
    const firstPro = professionals.find((p) => p.active);
    if (!firstPro) {
      toast.error(
        "Cargá al menos una profesional activa antes de crear turnos.",
      );
      return;
    }
    const now = new Date();
    now.setSeconds(0, 0);
    // Round up to the next 30-minute mark
    const minutes = now.getMinutes();
    const add = minutes === 0 || minutes === 30 ? 0 : minutes < 30 ? 30 - minutes : 60 - minutes;
    now.setMinutes(minutes + add);
    setDialogMode({
      type: "create",
      professionalId: firstPro.id,
      startsAt: now.toISOString(),
    });
    setDialogOpen(true);
  }

  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
        <p className="text-base font-medium">Todavía no hay profesionales</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Cargá al menos una profesional activa con su horario semanal en el
          menú &ldquo;Profesionales&rdquo; para que aparezca como columna acá.
        </p>
      </div>
    );
  }

  return (
    <>
      {isMobile ? (
        <div className="flex sm:hidden">
          <Button
            type="button"
            onClick={openCreateFromButton}
            className="w-full"
          >
            <Plus className="size-4" />
            Nuevo turno
          </Button>
        </div>
      ) : null}

      <div className="rounded-md border bg-card p-2 sm:p-4 zenna-calendar">
        <FullCalendar
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
          // Mobile: use a clean list view by default. timeGrid overlapped
          // events from multiple pros and made tap-to-create unreliable.
          // The "Nuevo turno" button above the calendar handles creation.
          initialView={isMobile ? "listDay" : "resourceTimeGridDay"}
          initialDate={initialDate}
          headerToolbar={
            isMobile
              ? { left: "prev,next", center: "title", right: "today" }
              : {
                  left: "prev,next today",
                  center: "title",
                  right: "resourceTimeGridDay,timeGridWeek",
                }
          }
          buttonText={{
            today: "Hoy",
            week: "Semana",
            day: "Día",
            list: "Lista",
          }}
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
    </>
  );
}
