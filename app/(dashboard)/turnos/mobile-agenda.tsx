"use client";

import { addDays, format, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/validations/appointments";
import {
  appointmentTotal,
  capitalize,
  countsTowardTotals,
  firstName,
  money,
  servicesLabel,
  WINDOW_DAYS_BACK,
  WINDOW_DAYS_FORWARD,
} from "./appointment-utils";
import type { AppointmentWithRelations, ProfessionalRow } from "./types";

type Props = {
  professionals: ProfessionalRow[];
  appointments: AppointmentWithRelations[];
  onOpenAppointment: (appointment: AppointmentWithRelations) => void;
  onCreate: (startsAtIso: string, professionalId: string) => void;
  /** Abre el WhatsApp de la clienta del turno. */
  onMessageClient: (appointment: AppointmentWithRelations) => void;
};

type Row =
  | { kind: "appointment"; appointment: AppointmentWithRelations }
  | { kind: "now" };

/**
 * Agenda para teléfono.
 *
 * En el escritorio la agenda es una grilla de columnas por profesional; abajo
 * de 768px esa grilla no se puede leer ni tocar. Acá usamos el mismo lenguaje
 * que la bandeja de WhatsApp — franja de contexto arriba, chips de filtro y
 * lista de filas altas — porque es la pantalla que el salón ya sabe recorrer
 * con el pulgar:
 *
 *   ┌───────────────────────────────┐
 *   │ ◷  Viernes, 8 de agosto  ⌄    │  ← franja: fecha + totales, abre el
 *   │    6 turnos · $ 48.000        │    calendario al tocarla
 *   ├───────────────────────────────┤
 *   │ ‹ Hoy ›            Día│Semana │
 *   ├───────────────────────────────┤
 *   │ Todas 6 │ ● Ana 3 │ ● Marta 3 │  ← las columnas de profesional del
 *   ├───────────────────────────────┤    escritorio, convertidas en filtro
 *   │ 09:00 ▏ Sofía G      $ 12.000 │
 *   │ 10:30 ▏ Corte + Color         │
 *   │       ▏ ● Ana  Confirmado     │
 *   └───────────────────────────────┘
 *
 * El color del profesional vive en el filete de 3px de la fila, igual que en
 * las tarjetas del escritorio, así la lista no se vuelve un arcoíris.
 */
export function MobileAgenda({
  professionals,
  appointments,
  onOpenAppointment,
  onCreate,
  onMessageClient,
}: Props) {
  // Este árbol sólo se monta en el cliente (el padre lo decide con
  // matchMedia), así que podemos leer el reloj al inicializar el estado.
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [proFilter, setProFilter] = useState<string>("all");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Reloj de baja frecuencia: mueve la línea de "ahora" y el apagado de los
  // turnos que ya pasaron sin re-renderizar la lista todo el tiempo.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const activeProfessionals = useMemo(
    () => professionals.filter((p) => p.active),
    [professionals],
  );

  const proById = useMemo(
    () => new Map(professionals.map((p) => [p.id, p])),
    [professionals],
  );

  const range = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor, { weekStartsOn: 1 });
      return { start, end: addDays(start, 7) };
    }
    return { start: cursor, end: addDays(cursor, 1) };
  }, [cursor, view]);

  /** Turnos del rango visible, en orden — antes de filtrar por profesional. */
  const inRange = useMemo(() => {
    const from = range.start.getTime();
    const to = range.end.getTime();
    return appointments
      .filter((a) => {
        const t = new Date(a.starts_at).getTime();
        return t >= from && t < to;
      })
      .sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
  }, [appointments, range]);

  const countsByPro = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of inRange) {
      if (!countsTowardTotals(a)) continue;
      map.set(a.professional_id, (map.get(a.professional_id) ?? 0) + 1);
    }
    return map;
  }, [inRange]);

  const visible = useMemo(
    () =>
      proFilter === "all"
        ? inRange
        : inRange.filter((a) => a.professional_id === proFilter),
    [inRange, proFilter],
  );

  const totals = useMemo(() => {
    const counted = visible.filter(countsTowardTotals);
    return {
      count: counted.length,
      revenue: counted.reduce((sum, a) => sum + appointmentTotal(a), 0),
    };
  }, [visible]);

  /** Agrupado por día: en "Semana" cada día lleva su propio encabezado. */
  const groups = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    for (const a of visible) {
      const key = format(new Date(a.starts_at), "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return [...map.entries()].map(([key, list]) => ({
      key,
      date: new Date(`${key}T00:00:00`),
      list,
    }));
  }, [visible]);

  /**
   * ¿El día visible cae fuera de lo que precargó el server? Si es así el día
   * se ve vacío aunque tenga turnos, y hay que decirlo: un "no hay turnos"
   * mentiroso hace que alguien sobrevenda una fecha.
   */
  const outsideWindow = useMemo(() => {
    const first = startOfDay(addDays(now, -WINDOW_DAYS_BACK));
    const last = startOfDay(addDays(now, WINDOW_DAYS_FORWARD));
    return range.start < first || range.start >= last;
  }, [now, range.start]);

  const title = useMemo(() => {
    if (view === "week") {
      const last = addDays(range.start, 6);
      const sameMonth = last.getMonth() === range.start.getMonth();
      const left = sameMonth
        ? format(range.start, "d", { locale: es })
        : format(range.start, "d 'de' MMM", { locale: es });
      return `${left} – ${format(last, "d 'de' MMMM", { locale: es })}`;
    }
    if (isSameDay(cursor, now)) {
      return `Hoy, ${format(cursor, "d 'de' MMMM", { locale: es })}`;
    }
    return capitalize(format(cursor, "EEEE d 'de' MMMM", { locale: es }));
  }, [cursor, now, range.start, view]);

  function shift(direction: -1 | 1) {
    setCursor((c) => addDays(c, direction * (view === "week" ? 7 : 1)));
  }

  /**
   * Alta rápida. Si hoy cae dentro de lo que estamos mirando arrancamos en la
   * próxima media hora; si no, a las 10:00 del primer día del rango. Y si hay
   * una profesional filtrada, el turno ya sale con esa profesional puesta.
   */
  function handleCreate() {
    const pro =
      (proFilter !== "all" ? proById.get(proFilter) : undefined) ??
      activeProfessionals[0];
    if (!pro) return;

    const todayInRange = now >= range.start && now < range.end;
    const startsAt = todayInRange ? new Date(now) : new Date(range.start);
    if (todayInRange) {
      startsAt.setSeconds(0, 0);
      const minutes = startsAt.getMinutes();
      startsAt.setMinutes(minutes + ((30 - (minutes % 30)) % 30));
    } else {
      startsAt.setHours(10, 0, 0, 0);
    }
    onCreate(startsAt.toISOString(), pro.id);
  }

  /**
   * Al cambiar de día o de filtro dejamos la lista parada en la hora actual,
   * que es lo que hace `scrollTime` en la grilla del escritorio. Depende del
   * día visible y no del reloj, así que no se mueve sola mientras la leen.
   */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const nowMarkerRef = useRef<HTMLLIElement | null>(null);
  const dayKey = format(cursor, "yyyy-MM-dd");
  useEffect(() => {
    const scroller = scrollerRef.current;
    const marker = nowMarkerRef.current;
    if (!scroller || !marker) return;
    scroller.scrollTop = Math.max(0, marker.offsetTop - 96);
  }, [dayKey, view, proFilter]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-card">
      {/* ── Franja de contexto: fecha + totales, abre el calendario ─────── */}
      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex shrink-0 items-center gap-3 bg-muted/60 px-4 py-3 text-left"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground">
              <CalendarDays className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1">
                <span className="truncate text-[1.0625rem] font-medium text-foreground">
                  {title}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="block truncate text-[0.8125rem] text-muted-foreground tabular-nums">
                {totals.count} {totals.count === 1 ? "turno" : "turnos"} ·{" "}
                {money(totals.revenue)}
              </span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={es}
            weekStartsOn={1}
            selected={cursor}
            defaultMonth={cursor}
            onSelect={(date) => {
              if (!date) return;
              setCursor(startOfDay(date));
              setDatePickerOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {/* ── Navegación ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="inline-flex items-center rounded-lg border border-input bg-card">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label={view === "week" ? "Semana anterior" : "Día anterior"}
            className="flex h-9 w-10 items-center justify-center rounded-l-lg text-muted-foreground active:bg-muted"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfDay(new Date()))}
            className="h-9 border-x border-input px-3 text-sm font-medium active:bg-muted"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label={view === "week" ? "Semana siguiente" : "Día siguiente"}
            className="flex h-9 w-10 items-center justify-center rounded-r-lg text-muted-foreground active:bg-muted"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="segmented ml-auto">
          <button
            type="button"
            data-active={view === "day"}
            onClick={() => setView("day")}
            className="segmented-item"
          >
            Día
          </button>
          <button
            type="button"
            data-active={view === "week"}
            onClick={() => setView("week")}
            className="segmented-item"
          >
            Semana
          </button>
        </div>
      </div>

      {/* ── Filtro por profesional (las columnas del escritorio) ────────── */}
      {activeProfessionals.length > 1 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip
            active={proFilter === "all"}
            onClick={() => setProFilter("all")}
          >
            Todas
            <span className="tabular-nums opacity-70">
              {inRange.filter(countsTowardTotals).length}
            </span>
          </FilterChip>
          {activeProfessionals.map((pro) => (
            <FilterChip
              key={pro.id}
              active={proFilter === pro.id}
              onClick={() =>
                setProFilter((current) => (current === pro.id ? "all" : pro.id))
              }
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: pro.color ?? "#94a3b8" }}
              />
              {firstName(pro.full_name)}
              <span className="tabular-nums opacity-70">
                {countsByPro.get(pro.id) ?? 0}
              </span>
            </FilterChip>
          ))}
        </div>
      ) : null}

      {/* ── Lista de turnos ─────────────────────────────────────────────── */}
      {/*
        El relleno de abajo deja pasar el botón flotante y la barra de
        pestañas: sin él, el último turno del día queda tapado.
      */}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto border-t border-border pb-[calc(5.5rem+var(--tabbar-space))]"
      >
        {groups.length === 0 ? (
          <div className="px-8 py-14 text-center">
            <p className="text-sm font-medium text-foreground">
              {outsideWindow
                ? "Fecha fuera de la agenda cargada"
                : proFilter === "all"
                  ? "No hay turnos"
                  : "Sin turnos para esta profesional"}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {outsideWindow
                ? "Recargá la página para traer los turnos de esta fecha."
                : `Tocá el botón «+» para agendar ${
                    view === "week" ? "en esta semana" : "en este día"
                  }.`}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              {view === "week" ? (
                <h2 className="sticky top-0 z-10 border-b border-border bg-muted/90 px-4 py-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {capitalize(
                    format(group.date, "EEEE d 'de' MMMM", { locale: es }),
                  )}
                </h2>
              ) : null}
              <ul>
                {withNowMarker(group.list, group.date, now).map((row, index) =>
                  row.kind === "now" ? (
                    <li
                      key={`now-${group.key}-${index}`}
                      ref={nowMarkerRef}
                      aria-hidden
                      className="flex items-center gap-2 px-3 py-1"
                    >
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-destructive tabular-nums">
                        {format(now, "HH:mm")}
                      </span>
                      <span className="h-px flex-1 bg-destructive/50" />
                    </li>
                  ) : (
                    <AppointmentRow
                      key={row.appointment.id}
                      appointment={row.appointment}
                      professional={proById.get(row.appointment.professional_id)}
                      showProfessional={
                        activeProfessionals.length > 1 && proFilter === "all"
                      }
                      // Apagamos sólo lo que ya pasó HOY: es el "por acá
                      // vamos" del día. En una fecha pasada apagar todo
                      // dejaría la pantalla entera lavada y sin jerarquía.
                      past={
                        isSameDay(group.date, now) &&
                        new Date(row.appointment.ends_at) < now
                      }
                      onClick={() => onOpenAppointment(row.appointment)}
                      onMessage={() => onMessageClient(row.appointment)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* ── Acción principal ──────────────────────────────────────────────
        Botón redondo flotante y no una barra a lo ancho: abajo de todo ya está
        la barra de pestañas de la app, y dos barras apiladas se comen 130px de
        agenda. Se apoya justo arriba de ella (`--tabbar-space`) y a la derecha,
        que es el gesto del "+" de WhatsApp.
      */}
      <button
        type="button"
        onClick={handleCreate}
        aria-label="Nuevo turno"
        className="absolute right-4 bottom-[calc(1rem+var(--tabbar-space))] z-30 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg active:opacity-90"
      >
        <Plus className="size-6" strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * Inserta la marca de "ahora" entre el último turno que pasó y el próximo.
 * Sólo tiene sentido en el día de hoy; en cualquier otro día no se dibuja.
 */
function withNowMarker(
  list: AppointmentWithRelations[],
  date: Date,
  now: Date,
): Row[] {
  const rows: Row[] = list.map((appointment) => ({
    kind: "appointment",
    appointment,
  }));
  if (!isSameDay(date, now)) return rows;

  const next = rows.findIndex(
    (row) =>
      row.kind === "appointment" &&
      new Date(row.appointment.starts_at).getTime() > now.getTime(),
  );
  if (next === -1) rows.push({ kind: "now" });
  else rows.splice(next, 0, { kind: "now" });
  return rows;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
        active
          ? "border-accent bg-accent font-medium text-accent-foreground"
          : "border-transparent bg-muted text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function AppointmentRow({
  appointment,
  professional,
  showProfessional,
  past,
  onClick,
  onMessage,
}: {
  appointment: AppointmentWithRelations;
  professional: ProfessionalRow | undefined;
  showProfessional: boolean;
  past: boolean;
  onClick: () => void;
  onMessage: () => void;
}) {
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at);
  const services = servicesLabel(appointment);
  const total = appointmentTotal(appointment);
  const dropped =
    appointment.status === "cancelled" || appointment.status === "no_show";
  const tone = STATUS_TONE[appointment.status];

  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-stretch gap-3 pl-3 text-left transition-opacity active:bg-muted/60",
          past && !dropped && "opacity-60",
        )}
      >
        {/* Riel de horas: es por donde se recorre la lista con la vista. */}
        <span className="w-[3.25rem] shrink-0 pt-2.5 text-right leading-tight">
          <span className="block text-[0.9375rem] font-semibold text-foreground tabular-nums">
            {format(start, "HH:mm")}
          </span>
          <span className="block text-[0.75rem] text-muted-foreground tabular-nums">
            {format(end, "HH:mm")}
          </span>
        </span>

        {/* Filete del profesional — el mismo código de color del escritorio. */}
        <span
          aria-hidden
          className="my-2.5 w-[3px] shrink-0 rounded-full"
          style={{
            backgroundColor: dropped
              ? "var(--border)"
              : (professional?.color ?? "#94a3b8"),
          }}
        />

        <span className="min-w-0 flex-1 border-b border-border py-2.5 [li:last-child_&]:border-b-0">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-[0.9375rem] font-medium text-foreground",
                dropped && "line-through decoration-1",
              )}
            >
              {appointment.clients?.full_name ?? "Sin clienta"}
            </span>
            {total > 0 ? (
              <span className="shrink-0 text-[0.8125rem] text-muted-foreground tabular-nums">
                {money(total)}
              </span>
            ) : null}
          </span>

          {services ? (
            <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">
              {services}
            </span>
          ) : null}

          {showProfessional ||
          appointment.status !== "scheduled" ||
          appointment.deposit_amount > 0 ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {showProfessional && professional ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: professional.color ?? "#94a3b8" }}
                  />
                  {firstName(professional.full_name)}
                </span>
              ) : null}
              {appointment.status !== "scheduled" ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
                    tone.bg,
                    tone.text,
                    tone.border,
                  )}
                >
                  {STATUS_LABEL[appointment.status]}
                </span>
              ) : null}
              {appointment.deposit_amount > 0 ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-900 tabular-nums">
                  Seña {money(appointment.deposit_amount)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>

      {/*
        Escribirle por WhatsApp, en su propia columna y no encima de la fila:
        acá el dedo elige entre "abrir el turno" y "mandarle un mensaje", y dos
        blancos que se pisan terminan siempre en el toque equivocado.
      */}
      <button
        type="button"
        onClick={onMessage}
        aria-label={`Mandarle un WhatsApp a ${appointment.clients?.full_name ?? "la clienta"}`}
        className="flex w-12 shrink-0 items-center justify-center border-b border-border text-muted-foreground active:bg-muted/60 [li:last-child_&]:border-b-0"
      >
        <MessageCircle className="size-5" strokeWidth={1.75} />
      </button>
    </li>
  );
}
