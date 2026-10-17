"use client";

import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameWeek,
  isSameYear,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { CalendarCheck, ChevronDown, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { MobileChromeAccount } from "@/components/dashboard/mobile-chrome";
import {
  FilterChip,
  Pill,
  Segmented,
} from "@/components/dashboard/phone-screen";
import {
  enterAnimation,
  SWIPE_FOLLOW,
  useHorizontalSwipe,
} from "@/components/dashboard/use-horizontal-swipe";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type AppointmentStatus,
  STATUS_LABEL,
} from "@/lib/validations/appointments";
import {
  appointmentTotal,
  capitalize,
  countsTowardTotals,
  firstName,
  initialOf,
  money,
  servicesLabel,
} from "./appointment-utils";
import { openClientConversationAction } from "../crm/actions";
import type { AppointmentWithRelations, ProfessionalRow } from "./types";
import {
  type LoadedWindow,
  useAppointmentWindow,
} from "./use-appointment-window";

type Props = {
  professionals: ProfessionalRow[];
  appointments: AppointmentWithRelations[];
  loadedWindow: LoadedWindow;
  onOpenAppointment: (appointment: AppointmentWithRelations) => void;
  onCreate: (startsAtIso: string, professionalId: string) => void;
};

type Row =
  | { kind: "appointment"; appointment: AppointmentWithRelations }
  | { kind: "now" }
  | { kind: "gap"; startsAt: Date; minutes: number };

type DayGroup = {
  key: string;
  date: Date;
  list: AppointmentWithRelations[];
  count: number;
  revenue: number;
};

/** Un hueco más corto que esto no entra ni un brushing: no se ofrece. */
const MIN_GAP_MINUTES = 30;

const VIEW_OPTIONS = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
] as const;

/** Color de una profesional sin color cargado. */
const FALLBACK_COLOR = "#94a3b8";

/**
 * Estado del turno en el oscuro del teléfono. `STATUS_TONE` es para el claro
 * del escritorio: sus fondos 100 sobre el gris de WhatsApp eran calcomanías
 * blancas. Acá van translúcidos, con el texto en el tono claro.
 */
const STATUS_PILL: Record<AppointmentStatus, string> = {
  scheduled: "bg-white/10 text-[var(--wa-text-2)]",
  confirmed: "bg-sky-400/15 text-sky-300",
  in_progress: "bg-amber-400/15 text-amber-300",
  completed: "bg-emerald-400/15 text-emerald-300",
  no_show: "bg-rose-400/15 text-rose-300",
  cancelled: "bg-white/10 text-[var(--wa-text-2)]",
};

/**
 * Agenda para teléfono.
 *
 * En el escritorio la agenda es una grilla de columnas por profesional; abajo
 * de 768px esa grilla no se puede leer ni tocar. Acá es la pantalla de
 * calendario de una app de teléfono, con el mismo encabezado que la bandeja
 * (título grande, cuenta arriba a la derecha) para que pasar de Chats a
 * Turnos no se sienta como cambiar de app:
 *
 *   ┌───────────────────────────────┐
 *   │ Hoy                Día│Sem (A)│
 *   │ Octubre ⌄                     │  ← título = mes; abre el calendario
 *   │ LU  MA  MI  JU  VI  SÁ  DO    │  ← tira de la semana: se desliza de
 *   │ 13  14 (15) 16  17  18  19    │    semana en semana; los puntos son
 *   │ ••   •   ••      •            │    las profesionales con turnos
 *   │ (Todas 6) (Ⓐ Ana 3) (Ⓜ Marta) │  ← las columnas del escritorio,
 *   ├───────────────────────────────┤    convertidas en filtro
 *   │ Hoy, miércoles 15   6 · $48k  │
 *   │ 09:00 ┃▌Sofía G.    $12.000 💬│  ← tarjeta teñida con el color de la
 *   │ 10:30 ┃ Corte + Color         │    profesional
 *   │ 10:12 ●───────────────────────│  ← ahora
 *   │ 11:00   Libre · 1 h   + Agendar│ ← huecos, con una sola profesional
 *   └───────────────────────────────┘
 *
 * La lista también se desliza: a la izquierda el día (o la semana) que
 * sigue, a la derecha el anterior.
 */
export function MobileAgenda({
  professionals,
  appointments,
  loadedWindow,
  onOpenAppointment,
  onCreate,
}: Props) {
  // Este árbol sólo se monta en el cliente (el padre lo decide con
  // matchMedia), así que podemos leer el reloj al inicializar el estado.
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [proFilter, setProFilter] = useState<string>("all");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  /** De qué lado entra el día nuevo: 1 = desde la derecha (hacia adelante). */
  const [enterFrom, setEnterFrom] = useState<-1 | 0 | 1>(0);
  /** Lo mismo para la tira, que sólo se mueve cuando cambia la semana. */
  const [stripEnterFrom, setStripEnterFrom] = useState<-1 | 0 | 1>(0);
  /** La lista se corrió: el encabezado gana su filete, como en iOS. */
  const [scrolled, setScrolled] = useState(false);

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

  const weekStart = useMemo(
    () => startOfWeek(cursor, { weekStartsOn: 1 }),
    [cursor],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const range = useMemo(() => {
    if (view === "week") return { start: weekStart, end: addDays(weekStart, 7) };
    return { start: cursor, end: addDays(cursor, 1) };
  }, [cursor, view, weekStart]);

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

  /**
   * Un grupo por día. En "Semana" van los siete aunque alguno esté vacío:
   * ver un día libre en el medio de la semana es justamente lo que se busca.
   */
  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, AppointmentWithRelations[]>();
    for (const a of visible) {
      const key = format(new Date(a.starts_at), "yyyy-MM-dd");
      const list = byDay.get(key);
      if (list) list.push(a);
      else byDay.set(key, [a]);
    }
    return (view === "week" ? weekDays : [cursor]).map((date) => {
      const key = format(date, "yyyy-MM-dd");
      const list = byDay.get(key) ?? [];
      const counted = list.filter(countsTowardTotals);
      return {
        key,
        date,
        list,
        count: counted.length,
        revenue: counted.reduce((sum, a) => sum + appointmentTotal(a), 0),
      };
    });
  }, [visible, view, weekDays, cursor]);

  /**
   * Puntos de la tira de días: uno por profesional con turnos ese día (hasta
   * tres), en su color. Sigue al filtro: con una profesional elegida, la tira
   * muestra sólo los días que ella tiene ocupados.
   */
  const dayMarks = useMemo(() => {
    const from = weekStart.getTime();
    const to = addDays(weekStart, 7).getTime();
    const map = new Map<string, string[]>();
    for (const a of appointments) {
      const t = new Date(a.starts_at).getTime();
      if (t < from || t >= to || !countsTowardTotals(a)) continue;
      if (proFilter !== "all" && a.professional_id !== proFilter) continue;
      const key = format(new Date(a.starts_at), "yyyy-MM-dd");
      const color = proById.get(a.professional_id)?.color ?? FALLBACK_COLOR;
      const colors = map.get(key) ?? [];
      if (!colors.includes(color)) colors.push(color);
      map.set(key, colors);
    }
    return map;
  }, [appointments, weekStart, proFilter, proById]);

  /**
   * ¿El rango visible todavía no llegó del server? Mientras tanto se ve vacío
   * aunque tenga turnos, y hay que decirlo: un "no hay turnos" mentiroso hace
   * que alguien sobrevenda una fecha.
   */
  const loadingRange = useAppointmentWindow(range, loadedWindow);

  /**
   * La profesional cuya agenda se puede leer como una sola fila de tiempo: la
   * filtrada, o la única que hay. Sólo ahí un hueco entre dos turnos es un
   * hueco de verdad — con todas mezcladas, el "libre" de una es el turno de
   * otra.
   */
  const focusedPro =
    proFilter !== "all"
      ? proById.get(proFilter)
      : activeProfessionals.length === 1
        ? activeProfessionals[0]
        : undefined;

  const showsToday = now >= range.start && now < range.end;
  const monthTitle = capitalize(
    format(cursor, isSameYear(cursor, now) ? "MMMM" : "MMMM yyyy", {
      locale: es,
    }),
  );

  /**
   * Va a otro día; lo que cambia entra desde el lado que corresponde. En
   * "Semana", otro día de la misma semana no cambia la lista: sólo la desplaza
   * (ver el efecto de scroll), así que no se anima.
   */
  function goTo(date: Date) {
    const target = startOfDay(date);
    const delta = differenceInCalendarDays(target, cursor);
    if (delta === 0) return;
    const direction = delta > 0 ? 1 : -1;
    const sameWeek = isSameWeek(target, cursor, { weekStartsOn: 1 });
    if (!sameWeek) setStripEnterFrom(direction);
    if (view === "day" || !sameWeek) setEnterFrom(direction);
    setCursor(target);
  }

  function shift(direction: -1 | 1) {
    goTo(addDays(cursor, direction * (view === "week" ? 7 : 1)));
  }

  function changeView(next: "day" | "week") {
    setEnterFrom(0);
    setView(next);
  }

  /**
   * Alta rápida. Si hoy cae dentro de lo que estamos mirando arrancamos en la
   * próxima media hora; si no, a las 10:00 del día elegido. Y si hay una
   * profesional filtrada, el turno ya sale con esa profesional puesta.
   */
  function handleCreate() {
    const pro = focusedPro ?? activeProfessionals[0];
    if (!pro) return;

    const todayInView = view === "day" ? isSameDay(cursor, now) : showsToday;
    const startsAt = todayInView ? new Date(now) : new Date(cursor);
    if (todayInView) {
      startsAt.setSeconds(0, 0);
      const minutes = startsAt.getMinutes();
      startsAt.setMinutes(minutes + ((30 - (minutes % 30)) % 30));
    } else {
      startsAt.setHours(10, 0, 0, 0);
    }
    onCreate(startsAt.toISOString(), pro.id);
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const nowMarkerRef = useRef<HTMLLIElement | null>(null);

  useHorizontalSwipe(scrollerRef, shift);
  useHorizontalSwipe(stripRef, (direction) =>
    goTo(addDays(cursor, direction * 7)),
  );

  /**
   * Al cambiar de día dejamos la lista parada en la hora actual, que es lo
   * que hace `scrollTime` en la grilla del escritorio; en "Semana", en el día
   * elegido de la tira. Depende del día visible y no del reloj, así que no se
   * mueve sola mientras la leen.
   */
  const dayKey = format(cursor, "yyyy-MM-dd");
  const weekKey = format(weekStart, "yyyy-MM-dd");
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // En "Día" el ancla es el último turno que pasó, no la línea de ahora:
    // así queda a la vista dónde se viene.
    const target =
      view === "week"
        ? scroller.querySelector<HTMLElement>(`[data-day="${dayKey}"]`)
        : ((nowMarkerRef.current?.previousElementSibling as HTMLElement | null) ??
          nowMarkerRef.current);
    if (!target) {
      scroller.scrollTop = 0;
      return;
    }
    const offset =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    if (view === "week") {
      scroller.scrollTop = offset;
      return;
    }
    // Si el ancla está cerca del principio, mejor no mover nada que dejar el
    // título del día cortado a la mitad debajo del encabezado.
    const top = offset - 12;
    scroller.scrollTop = top < 96 ? 0 : top;
  }, [dayKey, view, proFilter, loadingRange]);

  // El contenido se vuelve a montar al cambiar de día (o de semana): así
  // entra con la animación del costado. Elegir otro día de la misma semana en
  // "Semana" sólo desplaza la lista.
  const contentKey = view === "week" ? `w-${weekKey}` : `d-${dayKey}`;

  function renderRows(group: DayGroup) {
    const withGaps =
      view === "day" && focusedPro !== undefined && group.date >= startOfDay(now);

    return buildRows(group.list, group.date, now, withGaps).map((row) => {
      if (row.kind === "now") {
        return <NowMarker key="now" ref={nowMarkerRef} now={now} />;
      }
      if (row.kind === "gap") {
        return (
          <GapRow
            key={`gap-${row.startsAt.getTime()}`}
            startsAt={row.startsAt}
            minutes={row.minutes}
            onClick={() => {
              if (focusedPro) onCreate(row.startsAt.toISOString(), focusedPro.id);
            }}
          />
        );
      }
      return (
        <AppointmentCard
          key={row.appointment.id}
          appointment={row.appointment}
          professional={proById.get(row.appointment.professional_id)}
          showProfessional={activeProfessionals.length > 1 && proFilter === "all"}
          // Apagamos sólo lo que ya pasó HOY: es el "por acá vamos" del día.
          // En una fecha pasada apagar todo dejaría la pantalla entera lavada
          // y sin jerarquía.
          past={
            isSameDay(group.date, now) &&
            new Date(row.appointment.ends_at) < now
          }
          onOpen={() => onOpenAppointment(row.appointment)}
        />
      );
    });
  }

  const dayGroup = groups[0];

  return (
    <div className="wa-scope relative flex h-full min-h-0 flex-col bg-[var(--wa-panel)] text-[var(--wa-text)]">
      {/*
        Encabezado: el mismo de la bandeja. `data-mobile-header` hace que el
        chrome esconda su barra con el logo, y la cuenta se trae acá adentro
        con `MobileChromeAccount`.
      */}
      <div
        data-mobile-header
        className={cn(
          "shrink-0 border-b transition-colors",
          scrolled ? "border-[var(--wa-divider)]" : "border-transparent",
        )}
      >
        <div className="flex h-11 items-center gap-2 px-4">
          {showsToday ? null : (
            <button
              type="button"
              onClick={() => goTo(now)}
              className="h-8 rounded-full bg-[var(--wa-chip-on)] px-3.5 text-[0.8125rem] font-semibold text-[var(--wa-chip-on-text)] active:opacity-80"
            >
              Hoy
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              value={view}
              options={VIEW_OPTIONS}
              onChange={changeView}
            />
            <MobileChromeAccount />
          </div>
        </div>

        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${monthTitle}. Elegir otra fecha`}
              className="ml-4 mt-1 mb-3 flex items-center gap-1.5 rounded-lg active:opacity-70"
            >
              <span className="font-display text-[2rem] font-bold leading-none tracking-tight">
                {monthTitle}
              </span>
              <ChevronDown
                className="mt-1 size-5 text-[var(--wa-text-2)]"
                strokeWidth={2.25}
              />
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
                goTo(date);
                setDatePickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        {/* ── Tira de la semana ─────────────────────────────────────────── */}
        <div
          ref={stripRef}
          className="group/swipe touch-pan-y overflow-hidden px-2 pb-2 select-none"
        >
          <div
            key={weekKey}
            className={cn(
              "grid grid-cols-7",
              SWIPE_FOLLOW,
              enterAnimation(stripEnterFrom),
            )}
          >
            {weekDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              return (
                <DayCell
                  key={key}
                  day={day}
                  selected={isSameDay(day, cursor)}
                  today={isSameDay(day, now)}
                  past={day < startOfDay(now)}
                  colors={dayMarks.get(key) ?? []}
                  onSelect={() => goTo(day)}
                />
              );
            })}
          </div>
        </div>

        {/* ── Filtro por profesional (las columnas del escritorio) ────────── */}
        {activeProfessionals.length > 1 ? (
          <div className="hide-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
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
                <ProDot professional={pro} />
                {firstName(pro.full_name)}
                <span className="tabular-nums opacity-70">
                  {countsByPro.get(pro.id) ?? 0}
                </span>
              </FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Lista de turnos ─────────────────────────────────────────────── */}
      {/*
        El relleno de abajo deja pasar el botón flotante y la barra de
        pestañas: sin él, el último turno del día queda tapado.
      */}
      <div
        ref={scrollerRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
        className="group/swipe min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[calc(6rem+var(--tabbar-space))]"
      >
        <div key={contentKey} className={cn(SWIPE_FOLLOW, enterAnimation(enterFrom))}>
          {loadingRange && visible.length === 0 ? (
            <AgendaSkeleton />
          ) : view === "day" ? (
            <>
              <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-3">
                <h2 className="truncate text-[0.9375rem] font-semibold">
                  {dayHeading(cursor, now)}
                </h2>
                {dayGroup.count > 0 ? (
                  <DayTotals count={dayGroup.count} revenue={dayGroup.revenue} />
                ) : null}
              </div>
              {dayGroup.list.length === 0 ? (
                <EmptyDay
                  past={cursor < startOfDay(now)}
                  professional={proFilter === "all" ? undefined : focusedPro}
                  onCreate={handleCreate}
                />
              ) : (
                <ul className="space-y-2 px-4">{renderRows(dayGroup)}</ul>
              )}
            </>
          ) : (
            groups.map((group) => (
              <section key={group.key} data-day={group.key}>
                <h2 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-[var(--wa-panel)]/90 px-4 pt-3 pb-2 backdrop-blur-md">
                  <span
                    className={cn(
                      "truncate text-[0.9375rem] font-semibold",
                      isSameDay(group.date, now) && "text-[var(--wa-badge)]",
                    )}
                  >
                    {dayHeading(group.date, now, false)}
                  </span>
                  {group.count > 0 ? (
                    <DayTotals count={group.count} revenue={group.revenue} />
                  ) : null}
                </h2>
                {group.list.length === 0 ? (
                  <p className="px-4 pb-3 text-[0.8125rem] text-[var(--wa-text-3)]">
                    Sin turnos
                  </p>
                ) : (
                  <ul className="space-y-2 px-4 pb-2">{renderRows(group)}</ul>
                )}
              </section>
            ))
          )}
        </div>
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
        className="absolute right-4 bottom-[calc(1rem+var(--tabbar-space))] z-30 flex size-14 items-center justify-center rounded-2xl bg-[var(--wa-badge)] text-[var(--wa-badge-text)] shadow-[0_12px_28px_-10px_rgb(0_0_0/0.85)] transition-transform active:scale-95"
      >
        <Plus className="size-6" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * Las filas de un día: los turnos, la marca de "ahora" entre el último que
 * pasó y el próximo (sólo hoy), y —si se pide— los huecos libres entre
 * turnos. Un hueco de hoy arranca recién en el próximo cuarto de hora: lo
 * que ya pasó no se puede ofrecer.
 */
function buildRows(
  list: AppointmentWithRelations[],
  date: Date,
  now: Date,
  withGaps: boolean,
): Row[] {
  const rows: Row[] = [];
  const isToday = isSameDay(date, now);
  const earliest = isToday ? ceilToQuarter(now) : 0;
  let nowPlaced = !isToday;
  let busyUntil: number | null = null;

  for (const appointment of list) {
    const start = new Date(appointment.starts_at).getTime();

    if (!nowPlaced && start > now.getTime()) {
      rows.push({ kind: "now" });
      nowPlaced = true;
    }

    const counts = countsTowardTotals(appointment);
    if (withGaps && counts && busyUntil !== null) {
      const from = Math.max(busyUntil, earliest);
      const minutes = Math.round((start - from) / 60_000);
      if (minutes >= MIN_GAP_MINUTES) {
        rows.push({ kind: "gap", startsAt: new Date(from), minutes });
      }
    }

    rows.push({ kind: "appointment", appointment });
    if (counts) {
      busyUntil = Math.max(
        busyUntil ?? 0,
        new Date(appointment.ends_at).getTime(),
      );
    }
  }

  if (!nowPlaced) rows.push({ kind: "now" });
  return rows;
}

function ceilToQuarter(date: Date): number {
  const step = 15 * 60_000;
  return Math.ceil(date.getTime() / step) * step;
}

/**
 * "Hoy, miércoles 15" · "Mañana, jueves 16" · "Viernes 17 de octubre". En
 * "Semana" el mes sobra: ya está en el título y es el mismo para los siete.
 */
function dayHeading(date: Date, now: Date, withMonth = true): string {
  const delta = differenceInCalendarDays(date, now);
  const relative =
    delta === 0 ? "Hoy" : delta === 1 ? "Mañana" : delta === -1 ? "Ayer" : null;
  if (relative) return `${relative}, ${format(date, "EEEE d", { locale: es })}`;
  return capitalize(
    format(date, withMonth ? "EEEE d 'de' MMMM" : "EEEE d", { locale: es }),
  );
}

/** 45 → "45 min" · 60 → "1 h" · 90 → "1 h 30". */
function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

function DayTotals({ count, revenue }: { count: number; revenue: number }) {
  return (
    <span className="shrink-0 text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
      {count} {count === 1 ? "turno" : "turnos"}
      {revenue > 0 ? ` · ${money(revenue)}` : null}
    </span>
  );
}

/**
 * Un día de la tira. Elegido = círculo lleno (verde si es hoy, claro si no),
 * como en el calendario del iPhone; hoy sin elegir = el número en verde.
 */
function DayCell({
  day,
  selected,
  today,
  past,
  colors,
  onSelect,
}: {
  day: Date;
  selected: boolean;
  today: boolean;
  past: boolean;
  colors: string[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-current={today ? "date" : undefined}
      aria-label={`${capitalize(format(day, "EEEE d 'de' MMMM", { locale: es }))}${
        colors.length > 0 ? ", con turnos" : ""
      }`}
      className="flex flex-col items-center gap-1 rounded-2xl py-1 [-webkit-tap-highlight-color:transparent]"
    >
      <span
        className={cn(
          "text-[0.6875rem] font-medium tracking-wide uppercase",
          today ? "text-[var(--wa-badge)]" : "text-[var(--wa-text-3)]",
        )}
      >
        {format(day, "EEEEEE", { locale: es })}
      </span>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-[1.0625rem] font-semibold tabular-nums transition-colors",
          selected
            ? today
              ? "bg-[var(--wa-badge)] text-[var(--wa-badge-text)]"
              : "bg-[var(--wa-text)] text-[var(--wa-panel)]"
            : today
              ? "text-[var(--wa-badge)]"
              : past
                ? "text-[var(--wa-text-2)]"
                : "text-[var(--wa-text)]",
        )}
      >
        {format(day, "d")}
      </span>
      <span aria-hidden className="flex h-1.5 items-center gap-[3px]">
        {colors.slice(0, 3).map((color) => (
          <span
            key={color}
            className="size-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
    </button>
  );
}

/** Inicial de la profesional sobre su color: la firma de cada una en la lista. */
function ProDot({ professional }: { professional: ProfessionalRow }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[0.5625rem] font-bold text-black"
      style={{ backgroundColor: professional.color ?? FALLBACK_COLOR }}
    >
      {initialOf(professional.full_name)}
    </span>
  );
}

/**
 * Tarjeta de turno: teñida con el color de la profesional y con su filete a
 * la izquierda, el mismo código de color de las tarjetas del escritorio.
 */
function AppointmentCard({
  appointment,
  professional,
  showProfessional,
  past,
  onOpen,
}: {
  appointment: AppointmentWithRelations;
  professional: ProfessionalRow | undefined;
  showProfessional: boolean;
  past: boolean;
  onOpen: () => void;
}) {
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at);
  const services = servicesLabel(appointment);
  const total = appointmentTotal(appointment);
  const dropped =
    appointment.status === "cancelled" || appointment.status === "no_show";
  const color = professional?.color ?? FALLBACK_COLOR;
  const clientName = appointment.clients?.full_name ?? "Sin clienta";
  const client = appointment.clients;

  const router = useRouter();
  const [openingChat, startOpeningChat] = useTransition();

  /**
   * Abre el chat de la clienta en la bandeja de la app — no en el WhatsApp
   * del teléfono: la conversación tiene que quedar en Zenna, con su historial
   * y sus automatizaciones. Si nunca hubo chat con ella en el número nuevo,
   * se abre uno (es lo mismo que hace "Abrir chat" en el diálogo de mensajes).
   */
  function openChat() {
    if (!client) {
      toast.error("Este turno no tiene una clienta cargada.");
      return;
    }
    startOpeningChat(async () => {
      const result = await openClientConversationAction({
        clientId: client.id,
        phone: client.phone,
        displayName: client.full_name,
      });
      if (result.error || !result.conversationId) {
        toast.error(result.error ?? "No pudimos abrir el chat.");
        return;
      }
      router.push(`/crm?c=${result.conversationId}`);
    });
  }

  const showStatus = appointment.status !== "scheduled";
  const showPayment = appointment.charged_at || appointment.deposit_amount > 0;
  const showMeta =
    (showProfessional && professional) || showStatus || showPayment;

  return (
    <li
      className={cn(
        "flex gap-3 transition-opacity",
        past && !dropped && "opacity-55",
      )}
    >
      {/* Riel de horas: es por donde se recorre la lista con la vista. */}
      <div className="w-11 shrink-0 pt-3 text-right leading-tight">
        <div className="text-[0.875rem] font-semibold tabular-nums">
          {format(start, "HH:mm")}
        </div>
        <div className="mt-0.5 text-[0.6875rem] text-[var(--wa-text-3)] tabular-nums">
          {format(end, "HH:mm")}
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl",
          dropped
            ? "border border-dashed border-[var(--wa-border)]"
            : "ring-1 ring-white/[0.04] ring-inset",
        )}
        style={
          dropped
            ? undefined
            : {
                backgroundColor: `color-mix(in oklab, ${color} 11%, var(--card))`,
              }
        }
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-stretch gap-2.5 py-2.5 pl-2.5 pr-1 text-left active:bg-white/5"
        >
          <span
            aria-hidden
            className="w-[3px] shrink-0 rounded-full"
            style={{
              backgroundColor: dropped ? "var(--wa-border)" : color,
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "truncate text-[0.9375rem] font-semibold",
                  dropped &&
                    "text-[var(--wa-text-2)] line-through decoration-1",
                )}
              >
                {clientName}
              </span>
              {total > 0 ? (
                <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--wa-text-2)] tabular-nums">
                  {money(total)}
                </span>
              ) : null}
            </span>

            {services ? (
              <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
                {services}
              </span>
            ) : null}

            {showMeta ? (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {showProfessional && professional ? (
                  <span className="mr-0.5 inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--wa-text-2)]">
                    <ProDot professional={professional} />
                    {firstName(professional.full_name)}
                  </span>
                ) : null}
                {showStatus ? (
                  <Pill className={STATUS_PILL[appointment.status]}>
                    {STATUS_LABEL[appointment.status]}
                  </Pill>
                ) : null}
                {/* Verde sólo cuando se cerró la venta. Una seña es plata a
                    cuenta, no un turno pago: va en ámbar hasta que se cobre. */}
                {appointment.charged_at ? (
                  <Pill className="bg-emerald-400/15 text-emerald-300">
                    Cobrado
                  </Pill>
                ) : appointment.deposit_amount > 0 ? (
                  <Pill className="bg-amber-400/15 text-amber-300">
                    Seña {money(appointment.deposit_amount)} · falta cobrar
                  </Pill>
                ) : null}
              </span>
            ) : null}
          </span>
        </button>

        {/*
          Escribirle por WhatsApp, en su propia columna y no encima de la
          tarjeta: acá el dedo elige entre "abrir el turno" y "mandarle un
          mensaje", y dos blancos que se pisan terminan siempre en el toque
          equivocado. Lleva al chat de la clienta en la pestaña Chats.
        */}
        <button
          type="button"
          onClick={openChat}
          disabled={openingChat}
          aria-busy={openingChat}
          aria-label={`Abrir el chat de ${client?.full_name ?? "la clienta"}`}
          className={cn(
            "flex w-12 shrink-0 items-center justify-center border-l border-white/5 active:bg-white/5",
            client ? "text-[#25D366]" : "text-[var(--wa-text-3)] opacity-50",
          )}
        >
          {openingChat ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <WhatsAppIcon className="size-[1.375rem]" />
          )}
        </button>
      </div>
    </li>
  );
}

function NowMarker({
  ref,
  now,
}: {
  ref: RefObject<HTMLLIElement | null>;
  now: Date;
}) {
  return (
    <li ref={ref} aria-hidden className="flex items-center gap-3 py-0.5">
      <span className="w-11 shrink-0 text-right text-[0.6875rem] font-bold text-destructive tabular-nums">
        {format(now, "HH:mm")}
      </span>
      <span className="relative h-[1.5px] flex-1 rounded-full bg-destructive">
        <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full bg-destructive" />
      </span>
    </li>
  );
}

function GapRow({
  startsAt,
  minutes,
  onClick,
}: {
  startsAt: Date;
  minutes: number;
  onClick: () => void;
}) {
  return (
    <li className="flex gap-3">
      <span className="w-11 shrink-0 pt-2.5 text-right text-[0.6875rem] text-[var(--wa-text-3)] tabular-nums">
        {format(startsAt, "HH:mm")}
      </span>
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-dashed border-[var(--wa-border)] px-3.5 py-2.5 text-left text-[0.8125rem] text-[var(--wa-text-2)] active:bg-[var(--wa-hover)]"
      >
        <span className="flex-1">Libre · {durationLabel(minutes)}</span>
        <span className="inline-flex items-center gap-1 font-medium text-[var(--wa-accent)]">
          <Plus className="size-4" strokeWidth={2.25} />
          Agendar
        </span>
      </button>
    </li>
  );
}

function EmptyDay({
  past,
  professional,
  onCreate,
}: {
  past: boolean;
  professional: ProfessionalRow | undefined;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-[var(--wa-search-bg)] text-[var(--wa-text-2)]">
        <CalendarCheck className="size-7" strokeWidth={1.6} />
      </span>
      <p className="mt-4 text-[1.0625rem] font-semibold">
        {professional
          ? `${firstName(professional.full_name)} no tiene turnos`
          : past
            ? "No hubo turnos"
            : "Día libre"}
      </p>
      <p className="mt-1 max-w-[17rem] text-[0.8125rem] leading-relaxed text-balance text-[var(--wa-text-2)]">
        {past
          ? "No quedó nada agendado para este día."
          : "Todavía no hay nada agendado para este día."}
      </p>
      {past ? null : (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--wa-chip-on)] px-5 text-[0.875rem] font-semibold text-[var(--wa-chip-on-text)] active:opacity-80"
        >
          <Plus className="size-4" strokeWidth={2.25} />
          Agendar turno
        </button>
      )}
    </div>
  );
}

/** Mientras llega la ventana nueva: la forma de la lista, no un "cargando". */
function AgendaSkeleton() {
  return (
    <div role="status" aria-label="Cargando turnos" className="space-y-2 px-4 pt-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="w-11 shrink-0 pt-3">
            <div className="ml-auto h-3.5 w-9 animate-pulse rounded bg-[var(--wa-search-bg)]" />
          </div>
          <div
            className="h-[4.5rem] flex-1 animate-pulse rounded-2xl bg-[var(--wa-search-bg)]"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
