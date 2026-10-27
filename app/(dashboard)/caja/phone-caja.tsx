"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  FolderArchive,
  Landmark,
  Lock,
  LockOpen,
  type LucideIcon,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  ChipRow,
  Fab,
  FilterChip,
  HeaderIconButton,
  PHONE_CARD,
  PHONE_TITLE,
  PhoneError,
  PhoneGroup,
  PhoneHeader,
  PhoneRow,
  PhoneScreen,
  PhoneSection,
  Pill,
  PILL_TONE,
  RowIcon,
  TodayButton,
} from "@/components/dashboard/phone-screen";
import {
  enterAnimation,
  SWIPE_FOLLOW,
  useHorizontalSwipe,
} from "@/components/dashboard/use-horizontal-swipe";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { shiftDateStr, ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { deleteExpenseAction, reopenCajaAction } from "./actions";
import { CambiarMetodoDialog } from "./cambiar-metodo-dialog";
import { CloseDialog } from "./close-caja";
import { CobrarDialog } from "./cobrar-dialog";
import {
  type DayTotals,
  formatDiff,
  METHOD_GROUPS,
  type MethodGroup,
  methodGroup,
} from "./day-totals";
import { NewExpenseButton } from "./expense-dialog";
import {
  type CashClosingRow,
  type DayAppointment,
  type ExpenseRow,
  type PaymentWithDetails,
  saleBreakdown,
} from "./types";

/** El mismo interruptor que "Ocultar montos" del escritorio. */
const STORAGE_KEY = "caja:amounts-hidden";
const MASK = "$ •••••";

/**
 * "Ocultar montos" vive en el almacenamiento del navegador. Sin él (modo
 * privado) queda en memoria mientras dure la pestaña.
 */
const hiddenListeners = new Set<() => void>();
let hiddenInMemory = false;

function subscribeHidden(onChange: () => void) {
  hiddenListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    hiddenListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return hiddenInMemory;
  }
}

function toggleHidden() {
  const next = !readHidden();
  hiddenInMemory = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Sin almacenamiento: alcanza con la memoria.
  }
  for (const listener of hiddenListeners) listener();
}

const FALLBACK_COLOR = "#94a3b8";

/** Nombre corto de cada medio, para las pastillas y los renglones chicos. */
const SHORT: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transf.",
  credit_card: "Crédito",
  debit_card: "Débito",
  mp: "MP",
  other: "Otro",
};

/** Cada grupo de método con su ícono y su color, como en Finanzas. */
const GROUP_STYLE: Record<MethodGroup, { icon: LucideIcon; tone: string }> = {
  cash: { icon: Banknote, tone: "bg-emerald-400/15 text-emerald-300" },
  transfer: { icon: Landmark, tone: "bg-sky-400/15 text-sky-300" },
  other: { icon: CreditCard, tone: "bg-violet-400/15 text-violet-300" },
};

type Props = {
  selectedDate: string;
  today: string;
  isOwner: boolean;
  totals: DayTotals;
  cashExpensesForDay: number;
  salesTotal: number;
  pending: DayAppointment[];
  sales: DayAppointment[];
  /** Días de caja ya cerrados entre los pagos de las ventas. */
  closedCajaDates: string[];
  payments: PaymentWithDetails[];
  expenses: ExpenseRow[];
  totalExpensesMonth: number;
  monthLabel: string;
  closing: CashClosingRow | null;
  errors: {
    day: string | null;
    payments: string | null;
    closing: string | null;
  };
};

/**
 * Caja para teléfono.
 *
 * En el escritorio la caja es un documento de tablas; abajo de 768px esas
 * tablas se cortan a la derecha y "Cobrar" queda fuera de la pantalla. Acá es
 * la pantalla de una billetera, con el mismo encabezado que la agenda:
 *
 *   ┌───────────────────────────────┐
 *   │ Hoy                     👁  (A)│
 *   │ Hoy ⌄                  ‹   ›  │  ← el día; abre el calendario
 *   │ Caja del jueves 16 de octubre │
 *   ├───────────────────────────────┤
 *   │ ╭───────────────────────────╮ │
 *   │ │ Efectivo a rendir         │ │  ← lo que se cuenta al cerrar
 *   │ │ $ 48.500                  │ │
 *   │ │ [   🔒 Cerrar caja      ] │ │
 *   │ ╰───────────────────────────╯ │
 *   │ Ventas $120k │ Entró $95k     │
 *   │ Por cobrar · 3                │
 *   │ 10:00 ┃▌Sofía G.    │ Cobrar  │  ← tarjeta con el color de la
 *   │ Cobrados · $120.000           │    profesional, como en la agenda
 *   │ Entró hoy (Todo)(Efectivo)…   │
 *   │ Egresos de octubre            │
 *   └───────────────────────────────┘
 *
 * La pantalla se desliza de costado para pasar al día anterior o al
 * siguiente, igual que la agenda.
 */
export function PhoneCaja({
  selectedDate,
  today,
  isOwner,
  totals,
  cashExpensesForDay,
  salesTotal,
  pending,
  sales,
  closedCajaDates,
  payments,
  expenses,
  totalExpensesMonth,
  monthLabel,
  closing,
  errors,
}: Props) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  /** A qué día se está yendo mientras el servidor trae la caja nueva. */
  const [target, setTarget] = useState(selectedDate);
  /** De qué lado entra el día nuevo: 1 = desde la derecha (hacia adelante). */
  const [enterFrom, setEnterFrom] = useState<-1 | 0 | 1>(0);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => false);

  /** Montos de resumen: los que se tapan con el ojo. */
  const total = (n: number) => (hidden ? MASK : formatCurrency(n));

  const [cobrarTarget, setCobrarTarget] = useState<DayAppointment | null>(null);
  const [cobrarOpen, setCobrarOpen] = useState(false);

  const [metodoTarget, setMetodoTarget] = useState<DayAppointment | null>(
    null,
  );
  const [metodoOpen, setMetodoOpen] = useState(false);

  const [group, setGroup] = useState<MethodGroup | "all">("all");

  const isToday = selectedDate === today;
  const isFuture = selectedDate > today;

  function goTo(dateStr: string) {
    const from = navigating ? target : selectedDate;
    if (dateStr === from) return;
    setEnterFrom(dateStr > from ? 1 : -1);
    setTarget(dateStr);
    startNavigation(() => {
      router.replace(dateStr === today ? "/caja" : `/caja?date=${dateStr}`, {
        scroll: false,
      });
    });
  }

  function shift(direction: -1 | 1) {
    goTo(shiftDateStr(navigating ? target : selectedDate, direction));
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useHorizontalSwipe(scrollerRef, shift);

  // Día nuevo: la lista arranca arriba, no donde quedó la del día anterior.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [selectedDate]);

  const selected = parseDay(selectedDate);
  const byGroup = (g: MethodGroup) =>
    payments.filter((p) => methodGroup(p.method) === g);
  const visiblePayments = group === "all" ? payments : byGroup(group);

  return (
    <PhoneScreen
      scrollRef={scrollerRef}
      scrollClassName="group/swipe touch-pan-y"
      header={
        <PhoneHeader
          leading={isToday ? null : <TodayButton onClick={() => goTo(today)} />}
          actions={
            <HeaderIconButton
              label={hidden ? "Mostrar montos" : "Ocultar montos"}
              aria-pressed={hidden}
              onClick={toggleHidden}
            >
              {hidden ? (
                <EyeOff className="size-5" strokeWidth={1.9} />
              ) : (
                <Eye className="size-5" strokeWidth={1.9} />
              )}
            </HeaderIconButton>
          }
          title={
            <div className="px-4 pt-1 pb-3">
              <div className="flex items-center gap-2">
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${dayTitle(selectedDate, today)}. Elegir otro día`}
                      className="flex min-w-0 items-center gap-1.5 rounded-lg active:opacity-70"
                    >
                      <span className={cn(PHONE_TITLE, "truncate")}>
                        {dayTitle(selectedDate, today)}
                      </span>
                      <ChevronDown
                        className="mt-1 size-5 shrink-0 text-[var(--wa-text-2)]"
                        strokeWidth={2.25}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      locale={es}
                      weekStartsOn={1}
                      selected={selected}
                      defaultMonth={selected}
                      onSelect={(date) => {
                        if (!date) return;
                        setDatePickerOpen(false);
                        goTo(format(date, "yyyy-MM-dd"));
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <div className="-mr-2 ml-auto flex items-center">
                  <HeaderIconButton
                    label="Día anterior"
                    onClick={() => shift(-1)}
                  >
                    <ChevronLeft className="size-5" strokeWidth={2} />
                  </HeaderIconButton>
                  <HeaderIconButton
                    label="Día siguiente"
                    onClick={() => shift(1)}
                  >
                    <ChevronRight className="size-5" strokeWidth={2} />
                  </HeaderIconButton>
                </div>
              </div>
              <p className="mt-1.5 text-[0.8125rem] text-[var(--wa-text-2)]">
                Caja del {format(selected, "EEEE d 'de' MMMM", { locale: es })}
              </p>
            </div>
          }
        />
      }
      fab={
        isOwner ? (
          <NewExpenseButton
            key={selectedDate}
            defaultDate={selectedDate}
            trigger={
              <Fab
                label="Registrar egreso"
                className="w-auto gap-1.5 px-5 text-[0.9375rem] font-semibold"
              >
                <Plus className="size-5" strokeWidth={2.25} />
                Egreso
              </Fab>
            }
          />
        ) : null
      }
    >
      <div
        key={selectedDate}
        className={cn(
          SWIPE_FOLLOW,
          enterAnimation(enterFrom),
          navigating && "opacity-60",
        )}
      >
        {/* ── Lo que hay que contar ─────────────────────────────────────── */}
        <div
          className="mx-4 mt-1 rounded-3xl p-5 ring-1 ring-white/[0.05] ring-inset"
          style={{
            backgroundColor: "color-mix(in oklab, var(--gold) 9%, var(--card))",
          }}
        >
          <div className="flex items-center gap-2 text-[0.8125rem] text-[var(--wa-text-2)]">
            <Wallet className="size-4 text-gold" strokeWidth={1.9} />
            Efectivo a rendir
          </div>
          <div className="mt-2 font-display text-[2.5rem] leading-none font-bold tracking-tight tabular-nums">
            {total(totals.expectedCash)}
          </div>
          <p className="mt-2 text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
            Entró en efectivo {total(totals.cash)}
            {cashExpensesForDay > 0
              ? ` · egresos −${hidden ? MASK : formatCurrency(cashExpensesForDay)}`
              : null}
          </p>

          <ClosingBlock
            cajaDate={selectedDate}
            isOwner={isOwner}
            isFuture={isFuture}
            totals={totals}
            cashExpenses={cashExpensesForDay}
            closing={closing}
            loadError={errors.closing}
          />
        </div>

        <div className="mx-4 mt-2 grid grid-cols-2 gap-2">
          <StatTile
            label="Ventas del día"
            value={total(salesTotal)}
            detail={
              pending.length > 0
                ? `${sales.length} cobrado${sales.length === 1 ? "" : "s"} · ${pending.length} pendiente${pending.length === 1 ? "" : "s"}`
                : `${sales.length} cobrado${sales.length === 1 ? "" : "s"}`
            }
          />
          <StatTile
            label={isToday ? "Entró hoy" : "Entró ese día"}
            value={total(totals.total)}
            detail={`${totals.count} movimiento${totals.count === 1 ? "" : "s"}`}
          />
        </div>

        {/* ── Turnos del día: las ventas ──────────────────────────────── */}
        <PhoneSection
          title="Por cobrar"
          meta={errors.day ? null : pending.length}
        >
          {errors.day ? (
            <PhoneError
              title="No pudimos cargar los turnos pendientes de cobro."
              detail={errors.day}
            >
              Puede haber turnos sin cobrar que no se están mostrando. Recargá
              y, si sigue igual, avisá.
            </PhoneError>
          ) : pending.length === 0 ? (
            <PhoneGroup>
              <PhoneRow
                leading={
                  <RowIcon icon={CheckCircle2} className={PILL_TONE.green} />
                }
                title="Nada pendiente de cobro"
                subtitle={
                  sales.length > 0
                    ? "Todos los turnos del día están cobrados."
                    : "No hay turnos para cobrar este día."
                }
              />
            </PhoneGroup>
          ) : (
            <ul className="space-y-2 px-4">
              {pending.map((a) => (
                <PendingCard
                  key={a.id}
                  appointment={a}
                  onCobrar={() => {
                    setCobrarTarget(a);
                    setCobrarOpen(true);
                  }}
                />
              ))}
            </ul>
          )}
        </PhoneSection>

        {errors.day ? null : (
          <PhoneSection title="Cobrados" meta={total(salesTotal)}>
            {sales.length === 0 ? (
              <p className="px-4 text-[0.8125rem] text-[var(--wa-text-3)]">
                Todavía no se cobró ningún turno de este día.
              </p>
            ) : (
              <>
                <PhoneGroup>
                  {sales.map((a) => (
                    <SaleRow
                      key={a.id}
                      appointment={a}
                      onClick={() => {
                        setMetodoTarget(a);
                        setMetodoOpen(true);
                      }}
                    />
                  ))}
                </PhoneGroup>
                <SalesNote sales={sales} />
              </>
            )}
          </PhoneSection>
        )}

        {/* ── Dinero que entró: los movimientos ─────────────────────────── */}
        <PhoneSection
          title={isToday ? "Entró hoy" : "Entró ese día"}
          meta={errors.payments ? null : total(totals.total)}
        >
          {errors.payments ? (
            <PhoneError
              title="No pudimos cargar los movimientos de esta caja."
              detail={errors.payments}
            />
          ) : payments.length === 0 ? (
            <p className="px-4 text-[0.8125rem] text-[var(--wa-text-3)]">
              No entró plata en esta caja todavía.
            </p>
          ) : (
            <>
              {/* Separado por cómo se controla: el efectivo en el cajón, las
                  transferencias en el banco, el resto en sus resúmenes. */}
              <ChipRow>
                <FilterChip
                  active={group === "all"}
                  onClick={() => setGroup("all")}
                >
                  Todo
                  <span className="tabular-nums opacity-70">
                    {payments.length}
                  </span>
                </FilterChip>
                {METHOD_GROUPS.map((g) => (
                  <FilterChip
                    key={g.value}
                    active={group === g.value}
                    onClick={() =>
                      setGroup((current) =>
                        current === g.value ? "all" : g.value,
                      )
                    }
                  >
                    {g.label}
                    <span className="tabular-nums opacity-70">
                      {total(totals[g.value])}
                    </span>
                  </FilterChip>
                ))}
              </ChipRow>
              {group === "all" ? null : (
                <p className="-mt-1 px-4 pb-2 text-[0.75rem] text-[var(--wa-text-3)]">
                  {METHOD_GROUPS.find((g) => g.value === group)?.hint}
                </p>
              )}
              {visiblePayments.length === 0 ? (
                <p className="px-4 text-[0.8125rem] text-[var(--wa-text-3)]">
                  Nada por este medio.
                </p>
              ) : (
                <PhoneGroup>
                  {visiblePayments.map((p) => (
                    <PaymentRow
                      key={p.id}
                      payment={p}
                      cajaDate={selectedDate}
                    />
                  ))}
                </PhoneGroup>
              )}
            </>
          )}
        </PhoneSection>

        {/* ── Egresos del mes (sólo la dueña) ───────────────────────────── */}
        {isOwner ? (
          <PhoneSection
            title={`Egresos de ${monthLabel}`}
            meta={
              totalExpensesMonth > 0
                ? `−${hidden ? MASK : formatCurrency(totalExpensesMonth)}`
                : null
            }
          >
            {expenses.length === 0 ? (
              <p className="px-4 text-[0.8125rem] text-[var(--wa-text-3)]">
                Sin egresos cargados este mes.
              </p>
            ) : (
              <PhoneGroup>
                {expenses.map((e) => (
                  <ExpenseItem
                    key={e.id}
                    expense={e}
                    currentDate={selectedDate}
                  />
                ))}
              </PhoneGroup>
            )}
          </PhoneSection>
        ) : null}

        <div className="pt-6">
          <PhoneGroup>
            <PhoneRow
              href={`/caja/archivo?month=${selectedDate.slice(0, 7)}`}
              leading={<RowIcon icon={FolderArchive} />}
              title="Archivo y controles"
              subtitle="Cierres anteriores y diferencias"
              chevron
            />
          </PhoneGroup>
        </div>
      </div>

      <CobrarDialog
        open={cobrarOpen}
        onOpenChange={(open) => {
          setCobrarOpen(open);
          if (!open) setCobrarTarget(null);
        }}
        appointment={cobrarTarget}
      />

      <CambiarMetodoDialog
        key={metodoTarget?.id ?? "none"}
        open={metodoOpen}
        onOpenChange={(open) => {
          setMetodoOpen(open);
          if (!open) setMetodoTarget(null);
        }}
        sale={metodoTarget}
        isOwner={isOwner}
        closedCajaDates={closedCajaDates}
      />
    </PhoneScreen>
  );
}

/** "YYYY-MM-DD" al mediodía local, para que ningún huso corra el día. */
function parseDay(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}

/** "Hoy" · "Ayer" · "Mañana" · "Martes 14". */
function dayTitle(dateStr: string, today: string): string {
  const delta = differenceInCalendarDays(parseDay(dateStr), parseDay(today));
  if (delta === 0) return "Hoy";
  if (delta === -1) return "Ayer";
  if (delta === 1) return "Mañana";
  const text = format(parseDay(dateStr), "EEEE d", { locale: es });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={cn(PHONE_CARD, "px-4 py-3")}>
      <div className="text-[0.75rem] text-[var(--wa-text-2)]">{label}</div>
      <div className="mt-1 truncate text-[1.125rem] font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[0.6875rem] text-[var(--wa-text-3)]">
        {detail}
      </div>
    </div>
  );
}

/**
 * El cierre, adentro de la tarjeta del efectivo: es la respuesta a "¿cuánto
 * tiene que haber?". Abierta, un botón; cerrada, el conteo con su diferencia.
 */
function ClosingBlock({
  cajaDate,
  isOwner,
  isFuture,
  totals,
  cashExpenses,
  closing,
  loadError,
}: {
  cajaDate: string;
  isOwner: boolean;
  isFuture: boolean;
  totals: DayTotals;
  cashExpenses: number;
  closing: CashClosingRow | null;
  loadError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reopening, startReopen] = useTransition();

  if (loadError) {
    return (
      <div className="mt-4 border-t border-white/5 pt-4">
        <p className="text-[0.8125rem] font-medium text-rose-300">
          No pudimos cargar el cierre de esta caja.
        </p>
        <p className="mt-1 font-mono text-[0.6875rem] break-all text-[var(--wa-text-3)]">
          {loadError}
        </p>
      </div>
    );
  }

  const dialog = (
    <CloseDialog
      key={closing?.closed_at ?? "open"}
      open={open}
      onOpenChange={setOpen}
      cajaDate={cajaDate}
      expectedCash={totals.expectedCash}
      cashIncome={totals.cash}
      cashExpenses={cashExpenses}
      transferIncome={totals.transfer}
      initialCounted={closing ? Number(closing.counted_cash) : null}
      initialNotes={closing?.notes ?? ""}
    />
  );

  if (!closing) {
    return (
      <div className="mt-4 border-t border-white/5 pt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={isFuture}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--wa-badge)] text-[0.9375rem] font-semibold text-[var(--wa-badge-text)] active:opacity-85 disabled:bg-[var(--wa-search-bg)] disabled:text-[var(--wa-text-3)]"
        >
          <Lock className="size-4" strokeWidth={2.25} />
          Cerrar caja
        </button>
        <p className="mt-2 text-center text-[0.75rem] text-[var(--wa-text-3)]">
          {isFuture
            ? "Se puede cerrar cuando llegue el día."
            : "Al final del día contá el efectivo del cajón."}
        </p>
        {dialog}
      </div>
    );
  }

  const diff = Number(closing.counted_cash) - Number(closing.expected_cash);
  const matches = Math.abs(diff) < 0.01;
  // El cierre es una foto: si después entró un cobro o salió un egreso en
  // efectivo de este día, lo que se espera ya no es lo que se contó.
  const changedSinceClose =
    Math.abs(Number(closing.expected_cash) - totals.expectedCash) >= 0.01;

  function reopen() {
    if (!confirm("¿Reabrir esta caja? Se borra el cierre guardado.")) return;
    startReopen(async () => {
      const result = await reopenCajaAction(cajaDate);
      if (result.error) toast.error(result.error);
      else toast.success("Caja reabierta.");
    });
  }

  return (
    <div className="mt-4 border-t border-white/5 pt-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Lock className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[0.9375rem] font-semibold">Caja cerrada</div>
          <div className="text-[0.75rem] text-[var(--wa-text-2)] tabular-nums">
            {format(new Date(closing.closed_at), "d/M HH:mm", { locale: es })} ·
            contado {formatCurrency(closing.counted_cash)}
          </div>
        </div>
        <Pill
          className={
            matches
              ? PILL_TONE.green
              : diff > 0
                ? PILL_TONE.amber
                : PILL_TONE.red
          }
        >
          {matches ? "Coincide" : formatDiff(diff)}
        </Pill>
      </div>

      {closing.notes ? (
        <p className="mt-2 text-[0.75rem] text-[var(--wa-text-2)]">
          Nota: {closing.notes}
        </p>
      ) : null}

      {changedSinceClose ? (
        <p className="mt-2 flex items-start gap-1.5 text-[0.75rem] text-amber-300">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          Hubo movimientos después del cierre: ahora se esperan{" "}
          {formatCurrency(totals.expectedCash)} en efectivo.
          {isOwner
            ? " Corregí el conteo si hace falta."
            : " Avisale a la dueña."}
        </p>
      ) : null}

      {isOwner ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-9 rounded-full bg-white/10 text-[0.8125rem] font-medium active:bg-white/15"
          >
            Corregir conteo
          </button>
          <button
            type="button"
            onClick={reopen}
            disabled={reopening}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[0.8125rem] font-medium active:bg-white/15 disabled:opacity-50"
          >
            <LockOpen className="size-3.5" />
            Reabrir
          </button>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}

/** Inicial de la profesional sobre su color, como en la agenda. */
function ProTag({
  professional,
}: {
  professional: DayAppointment["professional"];
}) {
  if (!professional) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--wa-text-2)]">
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full text-[0.5625rem] font-bold text-black"
        style={{ backgroundColor: professional.color || FALLBACK_COLOR }}
      >
        {(professional.full_name.trim()[0] ?? "?").toUpperCase()}
      </span>
      {professional.full_name.trim().split(/\s+/)[0]}
    </span>
  );
}

/**
 * Turno por cobrar: la tarjeta de la agenda, teñida con el color de la
 * profesional, con "Cobrar" en su propia columna — tocar la tarjeta también
 * cobra, que es lo único que se hace con ella acá.
 */
function PendingCard({
  appointment: a,
  onCobrar,
}: {
  appointment: DayAppointment;
  onCobrar: () => void;
}) {
  const color = a.professional?.color || FALLBACK_COLOR;
  const services = a.services.map((s) => s.name).join(" + ");
  const balance = Math.max(0, a.total_price - a.deposit_amount);

  return (
    <li className="flex gap-3">
      <div className="w-11 shrink-0 pt-3 text-right leading-tight">
        <div className="text-[0.875rem] font-semibold tabular-nums">
          {formatInTimeZone(a.starts_at, ZENNA_TZ, "HH:mm")}
        </div>
        <div className="mt-0.5 text-[0.6875rem] text-[var(--wa-text-3)] tabular-nums">
          {formatInTimeZone(a.ends_at, ZENNA_TZ, "HH:mm")}
        </div>
      </div>

      <div
        className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl ring-1 ring-white/[0.04] ring-inset"
        style={{
          backgroundColor: `color-mix(in oklab, ${color} 11%, var(--card))`,
        }}
      >
        <button
          type="button"
          onClick={onCobrar}
          className="flex min-w-0 flex-1 items-stretch gap-2.5 py-2.5 pr-1 pl-2.5 text-left active:bg-white/5"
        >
          <span
            aria-hidden
            className="w-[3px] shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[0.9375rem] font-semibold">
                {a.client?.full_name ?? "Sin clienta"}
              </span>
              <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--wa-text-2)] tabular-nums">
                {a.total_price > 0
                  ? formatCurrency(a.total_price)
                  : "A definir"}
              </span>
            </span>
            {services ? (
              <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
                {services}
              </span>
            ) : null}
            {a.professional || a.deposit_amount > 0 ? (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <ProTag professional={a.professional} />
                {/* Una seña es plata a cuenta, no un turno pago: va en ámbar
                    hasta que se cierre la venta. */}
                {a.deposit_amount > 0 ? (
                  <Pill className={PILL_TONE.amber}>
                    Seña {formatCurrency(a.deposit_amount)}
                    {a.deposit_method ? ` · ${SHORT[a.deposit_method]}` : ""}
                    {a.deposit_paid_on
                      ? ` ${format(parseDay(a.deposit_paid_on), "d/M")}`
                      : ""}
                  </Pill>
                ) : null}
                {a.deposit_amount > 0 && a.total_price > 0 ? (
                  <span className="text-[0.75rem] text-[var(--wa-text-2)] tabular-nums">
                    falta {formatCurrency(balance)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </button>

        <button
          type="button"
          onClick={onCobrar}
          aria-label={`Cobrar el turno de ${a.client?.full_name ?? "la clienta"}`}
          className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 border-l border-white/5 text-[0.6875rem] font-semibold text-[var(--wa-accent)] active:bg-white/5"
        >
          <Wallet className="size-5" strokeWidth={1.9} />
          Cobrar
        </button>
      </div>
    </li>
  );
}

/**
 * Venta cerrada: de dónde salió cada peso. La seña puede haber entrado otro
 * día (en la caja de ese día); acá se ve igual, porque la venta es del turno.
 * Tocarla abre el cambio de método, por si se cargó mal cómo pagó.
 */
function SaleRow({
  appointment: a,
  onClick,
}: {
  appointment: DayAppointment;
  onClick: () => void;
}) {
  const b = saleBreakdown(a);
  const deposits = a.payments.filter((p) => p.is_deposit);
  const charges = a.payments.filter((p) => !p.is_deposit);
  const services = a.services.map((s) => s.name).join(" + ");

  const parts: string[] = [];
  if (b.deposit > 0) {
    parts.push(
      `Seña ${formatCurrency(b.deposit)} (${deposits
        .map(
          (p) => `${SHORT[p.method]} ${format(parseDay(p.caja_date), "d/M")}`,
        )
        .join(", ")})`,
    );
  }
  if (charges.length > 0) {
    parts.push(
      `${[...new Set(charges.map((p) => SHORT[p.method]))].join(" + ")} ${formatCurrency(b.charged)}`,
    );
  } else {
    parts.push("cubierto por la seña");
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-[var(--wa-hover)]"
      >
        <span className="w-10 shrink-0 pt-px text-[0.8125rem] font-semibold tabular-nums">
          {formatInTimeZone(a.starts_at, ZENNA_TZ, "HH:mm")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.9375rem] font-medium">
              {a.client?.full_name ?? "—"}
            </span>
            <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">
              {formatCurrency(b.total)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
            {[
              services,
              a.professional
                ? `con ${a.professional.full_name.trim().split(/\s+/)[0]}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
          <span className="mt-0.5 block text-[0.75rem] text-[var(--wa-text-3)] tabular-nums">
            {parts.join(" + ")}
          </span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 8 14"
          className="mt-1.5 h-3.5 w-2 shrink-0 text-[var(--wa-text-3)]"
        >
          <path
            d="M1 1l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </li>
  );
}

function SalesNote({ sales }: { sales: DayAppointment[] }) {
  let deposit = 0;
  let charged = 0;
  for (const a of sales) {
    const b = saleBreakdown(a);
    deposit += b.deposit;
    charged += b.charged;
  }
  if (deposit <= 0) return null;
  return (
    <p className="px-4 pt-2 text-[0.75rem] leading-relaxed text-[var(--wa-text-3)]">
      De las ventas, {formatCurrency(deposit)} son señas (cada una suma en la
      caja del día en que entró) y {formatCurrency(charged)} se cobraron al
      atender.
    </p>
  );
}

/** Un movimiento de plata: qué fue (seña o cobro), de quién y por dónde. */
function PaymentRow({
  payment: p,
  cajaDate,
}: {
  payment: PaymentWithDetails;
  cajaDate: string;
}) {
  const appt = p.appointments;
  const style = GROUP_STYLE[methodGroup(p.method)];
  const services =
    appt?.appointment_services
      .map((s) => s.services?.name)
      .filter(Boolean)
      .join(" + ") || null;

  const turnoDay = appt
    ? formatInTimeZone(appt.starts_at, ZENNA_TZ, "yyyy-MM-dd")
    : null;
  const turnoWhen = appt
    ? turnoDay === cajaDate
      ? null
      : `turno del ${formatInTimeZone(appt.starts_at, ZENNA_TZ, "EEE d/M HH:mm", { locale: es })}`
    : null;
  const dropped = appt?.status === "cancelled" || appt?.status === "no_show";

  // Señas viejas que entraron como línea de un cobro tienen la hora del cobro,
  // no la de la seña: en ese caso no mostramos una hora que confunde.
  const paidDay = formatInTimeZone(p.paid_at, ZENNA_TZ, "yyyy-MM-dd");
  const hour =
    paidDay === cajaDate
      ? formatInTimeZone(p.paid_at, ZENNA_TZ, "HH:mm")
      : null;

  const detail = [
    p.is_deposit ? "Seña" : "Cobro",
    methodGroup(p.method) === "other" ? PAYMENT_METHOD_LABEL[p.method] : null,
    turnoWhen ?? services,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <RowIcon icon={style.icon} className={style.tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium">
          {appt?.clients?.full_name ?? "—"}
        </span>
        <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
          {detail}
          {dropped ? (
            <span className="text-rose-300">
              {" "}
              · {appt?.status === "cancelled" ? "cancelado" : "no vino"}
            </span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right leading-tight">
        <span className="block text-[0.9375rem] font-semibold tabular-nums">
          {formatCurrency(p.amount)}
        </span>
        {hour ? (
          <span className="mt-0.5 block text-[0.6875rem] text-[var(--wa-text-3)] tabular-nums">
            {hour}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Un egreso del mes. Los que salen del efectivo de ESTA caja lo dicen con una
 * pastilla: son los que hacen que el efectivo a rendir no sea lo cobrado.
 */
function ExpenseItem({
  expense: e,
  currentDate,
}: {
  expense: ExpenseRow;
  currentDate: string;
}) {
  const [deleting, startDelete] = useTransition();

  const isCashFromOtherDay =
    e.payment_method === "cash" &&
    e.cash_source_date &&
    e.cash_source_date !== e.expense_date;
  const isTemplatePayment = !!e.template_id && e.cash_source_date === null;
  const affectsThisDay =
    e.payment_method === "cash" && e.cash_source_date === currentDate;

  const detail = [
    EXPENSE_CATEGORY_LABEL[e.category],
    format(parseDay(e.expense_date), "d MMM", { locale: es }),
    e.payment_method ? PAYMENT_METHOD_LABEL[e.payment_method] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function remove() {
    if (!confirm("¿Eliminar este egreso?")) return;
    startDelete(async () => {
      const result = await deleteExpenseAction(e.id);
      if (result?.error) toast.error(result.error);
      else toast.success("Egreso eliminado.");
    });
  }

  return (
    <li
      className={cn(
        "flex items-center gap-3 py-3 pr-2 pl-4",
        deleting && "opacity-50",
      )}
    >
      <RowIcon
        icon={Receipt}
        className={affectsThisDay ? PILL_TONE.red : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.9375rem] font-medium">
            {e.description || EXPENSE_CATEGORY_LABEL[e.category]}
          </span>
          <span
            className={cn(
              "shrink-0 text-[0.9375rem] font-semibold tabular-nums",
              affectsThisDay ? "text-rose-300" : "text-[var(--wa-text-2)]",
            )}
          >
            −{formatCurrency(e.amount)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
          {detail}
        </span>
        {affectsThisDay || isCashFromOtherDay || isTemplatePayment ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {affectsThisDay ? (
              <Pill className={PILL_TONE.red}>Sale de esta caja</Pill>
            ) : isCashFromOtherDay && e.cash_source_date ? (
              <Pill className={PILL_TONE.neutral}>
                Efectivo de la caja del{" "}
                {format(parseDay(e.cash_source_date), "d MMM", { locale: es })}
              </Pill>
            ) : null}
            {isTemplatePayment ? (
              <Pill className={PILL_TONE.neutral}>
                Gasto fijo · no afecta cajas
              </Pill>
            ) : null}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        aria-label="Eliminar egreso"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-3)] active:bg-[var(--wa-hover)] active:text-rose-300"
      >
        <Trash2 className="size-4" strokeWidth={1.9} />
      </button>
    </li>
  );
}
