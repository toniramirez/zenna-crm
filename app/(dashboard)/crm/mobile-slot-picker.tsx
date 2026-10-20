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
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  enterAnimation,
  SWIPE_FOLLOW,
  useHorizontalSwipe,
} from "@/components/dashboard/use-horizontal-swipe";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getAppointmentsInRangeAction } from "../turnos/actions";
import {
  capitalize,
  countsTowardTotals,
  servicesLabel,
} from "../turnos/appointment-utils";
import type {
  AppointmentWithRelations,
  ProfessionalRow,
} from "../turnos/types";
import type { LoadedWindow } from "../turnos/use-appointment-window";

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 30;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;

/** Color de una profesional sin color cargado. */
const FALLBACK_COLOR = "#94a3b8";

type Slot = { start: number; end: number; label: string };

/**
 * Un tramo del día: horarios seguidos libres, o horarios seguidos con algún
 * turno encima (y los turnos que los ocupan).
 */
type Block =
  | { kind: "free"; slots: Slot[] }
  | { kind: "busy"; slots: Slot[]; turnos: AppointmentWithRelations[] };

/** Los horarios de media hora del día que todavía no pasaron. */
function daySlots(day: Date, now: number): Slot[] {
  const slots: Slot[] = [];
  const open = new Date(day);
  open.setHours(OPEN_HOUR, 0, 0, 0);
  const close = new Date(day);
  close.setHours(CLOSE_HOUR, 0, 0, 0);
  for (let t = open.getTime(); t < close.getTime(); t += SLOT_MS) {
    if (t + SLOT_MS <= now) continue;
    slots.push({ start: t, end: t + SLOT_MS, label: format(t, "HH:mm") });
  }
  return slots;
}

function overlaps(a: AppointmentWithRelations, from: number, to: number) {
  return (
    new Date(a.starts_at).getTime() < to && new Date(a.ends_at).getTime() > from
  );
}

/**
 * Agrupa los horarios en tramos libres y ocupados, en orden. Un horario está
 * ocupado si algún turno lo pisa aunque sea en parte; los cancelados y los
 * no-show ya vienen filtrados. Un tramo ocupado sigue mientras algún turno
 * venga del horario anterior: dos turnos pegados son dos tramos, dos
 * encimados son uno solo.
 */
function buildBlocks(
  slots: Slot[],
  turnos: AppointmentWithRelations[],
): Block[] {
  const blocks: Block[] = [];
  let previous: AppointmentWithRelations[] = [];
  for (const slot of slots) {
    const over = turnos.filter((a) => overlaps(a, slot.start, slot.end));
    const last = blocks[blocks.length - 1];
    if (over.length === 0) {
      if (last?.kind === "free") last.slots.push(slot);
      else blocks.push({ kind: "free", slots: [slot] });
    } else if (last?.kind === "busy" && over.some((a) => previous.includes(a))) {
      last.slots.push(slot);
      for (const a of over) if (!last.turnos.includes(a)) last.turnos.push(a);
    } else {
      blocks.push({ kind: "busy", slots: [slot], turnos: over });
    }
    previous = over;
  }
  return blocks;
}

function freeMinutes(blocks: Block[]): number {
  return blocks.reduce(
    (sum, b) => (b.kind === "free" ? sum + b.slots.length * SLOT_MINUTES : sum),
    0,
  );
}

/** 30 → "0,5 h" · 120 → "2 h" · 270 → "4,5 h". */
function hoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours)
    ? `${hours} h`
    : `${Math.floor(hours)},5 h`;
}

/** "Hoy, martes 20 de octubre" · "Jueves 22 de octubre". */
function dayHeading(day: Date, today: Date): string {
  const delta = differenceInCalendarDays(day, today);
  const full = format(day, "EEEE d 'de' MMMM", { locale: es });
  if (delta === 0) return `Hoy, ${full}`;
  if (delta === 1) return `Mañana, ${full}`;
  return capitalize(full);
}

/**
 * Elegir día y horario en el teléfono, pensado para mirar disponibilidad
 * antes que para reservar: con el campo de fecha había que ir día por día a
 * ciegas, y la grilla de horarios marcaba "ocupado" sin decir con qué.
 *
 *   ┌───────────────────────────────┐
 *   │ Octubre ⌄          Hoy  ‹  ›  │  ← el mes abre el calendario
 *   │ LU  MA  MI  JU  VI  SÁ  DO    │  ← tira de la semana: se desliza de
 *   │ 19 (20) 21  22  23  24  25    │    semana en semana; abajo de cada
 *   │     6 h 14 h 3 h lleno 14 h   │    día, las horas que le quedan libres
 *   ├───────────────────────────────┤
 *   │ Jueves 22 de octubre  2 turnos│  ← se desliza de día en día
 *   │ ┌ Libre de 08:00 a 10:00 ───┐ │
 *   │ │ 08:00 08:30 09:00 09:30   │ │
 *   │ ┃ Valen        10:00–11:00    │  ← turno, como en la agenda
 *   │ ┃ Alisado                     │
 *   │ + Superponer otro turno       │  ← abre 10:00 · 10:30
 *   └───────────────────────────────┘
 *
 * Los turnos salen de lo que precargó la página y, en paralelo, se pide la
 * semana a la vista al server: así un turno que se agendó desde la agenda
 * con el chat abierto también aparece, y una semana fuera de lo precargado
 * no se ve vacía como si estuviera libre.
 */
export function MobileSlotPicker({
  professionals,
  professionalId,
  setProfessionalId,
  startsAt,
  setStartsAt,
  durationMinutes,
  appointments,
  appointmentsWindow,
}: {
  professionals: ProfessionalRow[];
  professionalId: string;
  setProfessionalId: (id: string) => void;
  startsAt: string;
  setStartsAt: (iso: string) => void;
  durationMinutes: number;
  appointments: AppointmentWithRelations[];
  /** Rango que precargó la página; afuera de él hay que esperar al server. */
  appointmentsWindow?: LoadedWindow;
}) {
  // Sólo se monta en el cliente con el diálogo abierto: leer el reloj al
  // inicializar el estado es seguro, y cada apertura arranca de cero.
  const [now] = useState(() => Date.now());
  const today = useMemo(() => startOfDay(now), [now]);
  const [cursor, setCursor] = useState<Date>(() => {
    const picked = startsAt ? startOfDay(new Date(startsAt)) : null;
    return picked && picked >= today ? picked : today;
  });
  /** De qué lado entra el día nuevo: 1 = desde la derecha (hacia adelante). */
  const [enterFrom, setEnterFrom] = useState<-1 | 0 | 1>(0);
  /** Lo mismo para la tira, que sólo se mueve cuando cambia la semana. */
  const [stripEnterFrom, setStripEnterFrom] = useState<-1 | 0 | 1>(0);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  /** El tramo ocupado cuyos horarios para superponer están a la vista. */
  const [openBusy, setOpenBusy] = useState<number | null>(null);

  const activePros = professionals.filter((p) => p.active);
  const pro = professionals.find((p) => p.id === professionalId);
  const proColor = pro?.color ?? FALLBACK_COLOR;

  const weekStart = useMemo(
    () => startOfWeek(cursor, { weekStartsOn: 1 }),
    [cursor],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekKey = format(weekStart, "yyyy-MM-dd");
  const dayKey = format(cursor, "yyyy-MM-dd");

  // ──── Turnos de la semana a la vista ──────────────────────────────────────
  const [fetched, setFetched] = useState<
    Record<string, AppointmentWithRelations[] | "error">
  >({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (requested.current.has(weekKey)) return;
    requested.current.add(weekKey);
    void getAppointmentsInRangeAction(
      weekStart.toISOString(),
      addDays(weekStart, 7).toISOString(),
    )
      .then((result) =>
        result.error ? "error" : (result.events as AppointmentWithRelations[]),
      )
      .catch(() => "error" as const)
      .then((value) => setFetched((prev) => ({ ...prev, [weekKey]: value })));
  }, [weekKey, weekStart]);

  // Lo que ya pasó no importa: alcanza con que lo precargado cubra de hoy
  // en adelante.
  const preloaded =
    appointmentsWindow !== undefined &&
    Math.max(weekStart.getTime(), today.getTime()) >=
      Date.parse(appointmentsWindow.start) &&
    addDays(weekStart, 7).getTime() <= Date.parse(appointmentsWindow.end);
  const entry = fetched[weekKey];
  const weekAppointments = Array.isArray(entry)
    ? entry
    : preloaded
      ? appointments
      : null;
  const loadFailed = entry === "error" && !preloaded;

  const proTurnos = useMemo(
    () =>
      (weekAppointments ?? [])
        .filter(
          (a) => a.professional_id === professionalId && countsTowardTotals(a),
        )
        .sort(
          (a, b) =>
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
    [weekAppointments, professionalId],
  );

  /** Horas libres de cada día de la tira (los que no pasaron). */
  const freeByDay = useMemo(() => {
    const map = new Map<string, number>();
    if (!professionalId || weekAppointments === null) return map;
    for (const day of weekDays) {
      if (day < today) continue;
      const slots = daySlots(day, now);
      if (slots.length === 0) continue;
      map.set(
        format(day, "yyyy-MM-dd"),
        freeMinutes(buildBlocks(slots, proTurnos)),
      );
    }
    return map;
  }, [professionalId, weekAppointments, weekDays, today, now, proTurnos]);

  const blocks = useMemo(
    () => buildBlocks(daySlots(cursor, now), proTurnos),
    [cursor, now, proTurnos],
  );
  const dayCount = proTurnos.filter((a) =>
    isSameDay(new Date(a.starts_at), cursor),
  ).length;

  // El turno nuevo dura lo que suman los servicios (media hora mientras no
  // se elija ninguno). Se marcan los turnos con los que se pisaría.
  const pickStart = startsAt ? new Date(startsAt).getTime() : null;
  const pickEnd =
    pickStart === null
      ? null
      : pickStart +
        (durationMinutes > 0 ? durationMinutes * 60 * 1000 : SLOT_MS);

  // ──── Navegación ──────────────────────────────────────────────────────────
  /** Va a otro día (nunca antes de hoy); lo nuevo entra desde su costado. */
  function goTo(date: Date) {
    const target = startOfDay(date) < today ? today : startOfDay(date);
    const delta = differenceInCalendarDays(target, cursor);
    if (delta === 0) return;
    const direction = delta > 0 ? 1 : -1;
    if (!isSameWeek(target, cursor, { weekStartsOn: 1 })) {
      setStripEnterFrom(direction);
    }
    setEnterFrom(direction);
    setCursor(target);
  }

  const dayRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  useHorizontalSwipe(dayRef, (direction) => goTo(addDays(cursor, direction)));
  useHorizontalSwipe(stripRef, (direction) =>
    goTo(addDays(cursor, direction * 7)),
  );

  const isCurrentWeek = isSameWeek(cursor, today, { weekStartsOn: 1 });
  const monthTitle = capitalize(
    format(cursor, isSameYear(cursor, today) ? "MMMM" : "MMMM yyyy", {
      locale: es,
    }),
  );

  if (activePros.length === 0) {
    return (
      <div className="rounded-md border bg-card p-3 min-w-0">
        <p className="text-sm text-muted-foreground text-center px-2 py-4">
          Todavía no hay profesionales activas. Cargá al menos una en
          «Profesionales» para poder agendar.
        </p>
      </div>
    );
  }

  function renderSlot(slot: Slot, busy: boolean) {
    const picked = pickStart === slot.start;
    return (
      <button
        type="button"
        key={slot.start}
        onClick={() => setStartsAt(new Date(slot.start).toISOString())}
        aria-pressed={picked}
        className={cn(
          "rounded-md border px-2 py-2 text-sm tabular-nums transition-colors",
          picked
            ? "bg-foreground text-background border-foreground font-semibold"
            : busy
              ? "bg-amber-50 text-amber-900 border-amber-300 active:bg-amber-100"
              : "bg-card active:bg-muted/40",
        )}
      >
        {slot.label}
      </button>
    );
  }

  function renderDay() {
    if (!professionalId) {
      return (
        <p className="px-1 py-3 text-xs text-muted-foreground italic">
          Elegí una profesional para ver los horarios.
        </p>
      );
    }
    if (loadFailed) {
      return (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          No pudimos cargar los turnos de esta semana. Cerrá y volvé a abrir
          para reintentar.
        </p>
      );
    }
    if (weekAppointments === null) {
      return (
        <div role="status" aria-label="Cargando turnos" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl bg-muted"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      );
    }
    if (blocks.length === 0) {
      return (
        <p className="px-1 py-3 text-xs text-muted-foreground italic">
          Ya no quedan horarios para hoy.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {blocks.map((block) => {
          const first = block.slots[0]!;
          const last = block.slots[block.slots.length - 1]!;
          if (block.kind === "free") {
            return (
              <div
                key={`free-${first.start}`}
                className="rounded-xl border border-dashed p-2.5"
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  Libre de {first.label} a {format(last.end, "HH:mm")} ·{" "}
                  {hoursLabel(block.slots.length * SLOT_MINUTES)}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {block.slots.map((slot) => renderSlot(slot, false))}
                </div>
              </div>
            );
          }
          return (
            <div key={`busy-${first.start}`} className="space-y-1.5">
              {block.turnos.map((a) => {
                const start = new Date(a.starts_at);
                const end = new Date(a.ends_at);
                const services = servicesLabel(a);
                const clash =
                  pickStart !== null &&
                  pickEnd !== null &&
                  overlaps(a, pickStart, pickEnd);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex items-stretch gap-2.5 rounded-xl px-2.5 py-2",
                      clash && "ring-2 ring-inset ring-amber-400",
                    )}
                    style={{
                      backgroundColor: `color-mix(in oklab, ${proColor} 11%, var(--card))`,
                    }}
                  >
                    <span
                      aria-hidden
                      className="w-[3px] shrink-0 rounded-full"
                      style={{ backgroundColor: proColor }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {a.clients?.full_name ?? "Sin clienta"}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {format(start, "HH:mm")}–{format(end, "HH:mm")}
                        </span>
                      </span>
                      {services ? (
                        <span className="block text-xs text-muted-foreground">
                          {services}
                        </span>
                      ) : null}
                      {clash ? (
                        <span className="mt-0.5 block text-[11px] font-medium text-amber-700">
                          Se superpone con el turno nuevo
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {/* Los horarios ocupados se pueden elegir igual: a veces se
                  agenda un turno encima de otro (un brushing mientras actúa
                  un color). Es lo menos común, así que va plegado. */}
              {openBusy === first.start ||
              block.slots.some((slot) => slot.start === pickStart) ? (
                <div className="space-y-1.5">
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Superponer a las
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {block.slots.map((slot) => renderSlot(slot, true))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenBusy(first.start)}
                  className="inline-flex h-8 items-center gap-1 px-1 text-xs font-medium text-muted-foreground active:opacity-70"
                >
                  <Plus className="size-3.5" />
                  Superponer otro turno
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      {/*
        Profesional con botones y no con un Select: el Select abierto pone la
        primera opción justo encima del disparador, y Radix descarta el toque
        que cae a menos de 10px del que lo abrió. En algunos iPhone eso dejaba
        la lista abierta con la profesional a la vista pero sin elegir, y los
        horarios nunca aparecían. Un botón es un toque y no tiene esa trampa.
      */}
      {activePros.length > 1 ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Profesional</Label>
          <div
            role="radiogroup"
            aria-label="Profesional"
            className="flex flex-wrap gap-1.5"
          >
            {activePros.map((p) => {
              const picked = p.id === professionalId;
              return (
                <button
                  type="button"
                  key={p.id}
                  role="radio"
                  aria-checked={picked}
                  onClick={() => setProfessionalId(p.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    picked
                      ? "bg-foreground text-background border-foreground font-semibold"
                      : "bg-card hover:bg-muted/40"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.full_name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card">
        {/* ── Mes y semana ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 px-3 pt-2.5">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${monthTitle}. Elegir otra fecha`}
                className="flex items-center gap-1 rounded-md text-base font-semibold active:opacity-70"
              >
                {monthTitle}
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                locale={es}
                weekStartsOn={1}
                selected={cursor}
                defaultMonth={cursor}
                disabled={{ before: today }}
                onSelect={(date) => {
                  if (!date) return;
                  goTo(date);
                  setDatePickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <div className="ml-auto flex items-center gap-0.5">
            {isSameDay(cursor, today) ? null : (
              <button
                type="button"
                onClick={() => goTo(today)}
                className="mr-1 h-7 rounded-full border px-2.5 text-xs font-medium active:bg-muted/40"
              >
                Hoy
              </button>
            )}
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={isCurrentWeek}
              onClick={() => goTo(addDays(cursor, -7))}
              className="flex size-8 items-center justify-center rounded-full active:bg-muted/40 disabled:opacity-30"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Semana siguiente"
              onClick={() => goTo(addDays(cursor, 7))}
              className="flex size-8 items-center justify-center rounded-full active:bg-muted/40"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div
          ref={stripRef}
          className="group/swipe touch-pan-y overflow-hidden px-1 pt-1 pb-2 select-none"
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
              const past = day < today;
              const selected = isSameDay(day, cursor);
              const isToday = isSameDay(day, today);
              const free = freeByDay.get(key);
              return (
                <button
                  type="button"
                  key={key}
                  disabled={past}
                  onClick={() => goTo(day)}
                  aria-pressed={selected}
                  aria-label={`${capitalize(
                    format(day, "EEEE d 'de' MMMM", { locale: es }),
                  )}${
                    free === undefined
                      ? ""
                      : free === 0
                        ? ", sin lugar"
                        : `, ${hoursLabel(free)} libres`
                  }`}
                  className="flex flex-col items-center gap-0.5 py-1 disabled:opacity-35 [-webkit-tap-highlight-color:transparent]"
                >
                  <span
                    className={cn(
                      "text-[11px] font-medium uppercase",
                      isToday ? "text-emerald-600" : "text-muted-foreground",
                    )}
                  >
                    {format(day, "EEEEEE", { locale: es })}
                  </span>
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-base font-semibold tabular-nums transition-colors",
                      selected
                        ? "bg-foreground text-background"
                        : isToday
                          ? "text-emerald-600"
                          : undefined,
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <span
                    className={cn(
                      "h-3.5 text-[10px] leading-3.5 tabular-nums",
                      free === 0
                        ? "font-medium text-amber-700"
                        : "text-muted-foreground",
                    )}
                  >
                    {free === undefined ? "" : free === 0 ? "lleno" : hoursLabel(free)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── El día elegido: se desliza para pasar al siguiente ─────────── */}
      <div ref={dayRef} className="group/swipe touch-pan-y overflow-hidden">
        <div
          key={dayKey}
          className={cn("space-y-2", SWIPE_FOLLOW, enterAnimation(enterFrom))}
        >
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h3 className="truncate text-sm font-semibold">
              {dayHeading(cursor, today)}
            </h3>
            {professionalId && weekAppointments !== null ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {dayCount} {dayCount === 1 ? "turno" : "turnos"}
                {blocks.length > 0
                  ? ` · ${
                      freeMinutes(blocks) === 0
                        ? "sin lugar"
                        : `${hoursLabel(freeMinutes(blocks))} libres`
                    }`
                  : null}
              </span>
            ) : null}
          </div>
          {renderDay()}
        </div>
      </div>
    </div>
  );
}
