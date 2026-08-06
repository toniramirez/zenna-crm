import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ZENNA_TZ } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/validations/payments";

/**
 * Qué fecha define a qué mes pertenece un cobro:
 *   "pago"  → paid_at, el momento en que entró la plata (default; es lo que
 *             usa Finanzas › Estadísticas para "Ingresos del mes").
 *   "turno" → appointments.starts_at, el día del turno. Es el criterio que usa
 *             la Caja diaria, así que sirve para reconciliar contra ella.
 */
export type IncomeBasis = "pago" | "turno";

export function safeBasis(input: string | undefined | null): IncomeBasis {
  return input === "turno" ? "turno" : "pago";
}

/** Efectivo, transferencia y MercadoPago primero: son los que más se miran. */
export const METHOD_ORDER: PaymentMethod[] = [
  "cash",
  "transfer",
  "mp",
  "debit_card",
  "credit_card",
  "other",
];

/** Los tres que el reporte muestra como columnas propias en la tabla diaria. */
export const HEADLINE_METHODS: PaymentMethod[] = ["cash", "transfer", "mp"];

export type MethodTotal = {
  method: PaymentMethod;
  label: string;
  amount: number;
  count: number;
  /** Porcentaje sobre el total del mes (0 si el mes está vacío). */
  pct: number;
};

export type IncomeDetail = {
  id: string;
  method: PaymentMethod;
  amount: number;
  /** "YYYY-MM-DD" en horario de Córdoba — fecha del cobro. */
  paidDay: string;
  /** "HH:mm" en horario de Córdoba — hora del cobro. */
  paidTime: string;
  /** "YYYY-MM-DD" del turno, o null si el turno no tiene fecha. */
  appointmentDay: string | null;
  clientName: string;
  professionalName: string | null;
  professionalColor: string | null;
  services: string[];
  notes: string | null;
};

export type DayRow = {
  /** "YYYY-MM-DD" según el criterio elegido. */
  date: string;
  total: number;
  count: number;
  byMethod: Record<PaymentMethod, number>;
};

export type MethodBreakdown = {
  method: PaymentMethod;
  label: string;
  amount: number;
  count: number;
  pct: number;
  /** Promedio por cobro. */
  average: number;
  /** Cobros que componen el total, del más nuevo al más viejo. */
  payments: IncomeDetail[];
  /** Quién generó esa plata (por profesional del turno). */
  byProfessional: {
    id: string;
    name: string;
    color: string;
    amount: number;
    count: number;
  }[];
};

export type MonthIncomeReport = {
  /** "YYYY-MM" */
  month: string;
  basis: IncomeBasis;
  total: number;
  count: number;
  /** Todos los métodos con movimiento, en METHOD_ORDER. */
  byMethod: MethodTotal[];
  /** Días con movimiento, cronológico. */
  byDay: DayRow[];
  /** Un bloque por método con movimiento, en METHOD_ORDER. */
  breakdowns: MethodBreakdown[];
  /** Cobro más alto del mes, para dar contexto. */
  largest: IncomeDetail | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" → rango [start, end) en UTC que cubre el mes en horario de Córdoba. */
function monthRangeUTC(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: fromZonedTime(`${month}-01T00:00:00.000`, ZENNA_TZ).toISOString(),
    end: fromZonedTime(
      `${nextY}-${pad(nextM)}-01T00:00:00.000`,
      ZENNA_TZ,
    ).toISOString(),
  };
}

function emptyByMethod(): Record<PaymentMethod, number> {
  return {
    cash: 0,
    transfer: 0,
    credit_card: 0,
    debit_card: 0,
    mp: 0,
    other: 0,
  };
}

type PaymentJoinRow = {
  id: string;
  amount: number | string;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
  appointments: {
    id: string;
    starts_at: string | null;
    professionals: { id: string; full_name: string; color: string } | null;
    clients: { id: string; full_name: string } | null;
    appointment_services: { services: { name: string } | null }[];
  } | null;
};

const SELECT = `
  id, amount, method, paid_at, notes,
  appointments!inner (
    id, starts_at,
    professionals ( id, full_name, color ),
    clients ( id, full_name ),
    appointment_services ( services ( name ) )
  )
`;

const PAGE_SIZE = 1000;

/**
 * Trae todos los cobros del mes. Pagina de a 1000 porque PostgREST tiene un
 * tope de filas por request y un mes cargado puede pasarlo.
 */
async function fetchPayments(
  month: string,
  basis: IncomeBasis,
): Promise<PaymentJoinRow[]> {
  const supabase = await createClient();
  const { start, end } = monthRangeUTC(month);
  const dateColumn = basis === "turno" ? "appointments.starts_at" : "paid_at";

  const rows: PaymentJoinRow[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("payments")
      .select(SELECT)
      .gte(dateColumn, start)
      .lt(dateColumn, end)
      .order("paid_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const batch = (data as unknown as PaymentJoinRow[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function loadMonthIncome(
  month: string,
  basis: IncomeBasis = "pago",
): Promise<MonthIncomeReport> {
  const rows = await fetchPayments(month, basis);

  const details: IncomeDetail[] = rows.map((r) => {
    const paid = new Date(r.paid_at);
    return {
      id: r.id,
      method: r.method,
      amount: Number(r.amount),
      paidDay: formatInTimeZone(paid, ZENNA_TZ, "yyyy-MM-dd"),
      paidTime: formatInTimeZone(paid, ZENNA_TZ, "HH:mm"),
      appointmentDay: r.appointments?.starts_at
        ? formatInTimeZone(
            new Date(r.appointments.starts_at),
            ZENNA_TZ,
            "yyyy-MM-dd",
          )
        : null,
      clientName: r.appointments?.clients?.full_name ?? "Sin clienta",
      professionalName: r.appointments?.professionals?.full_name ?? null,
      professionalColor: r.appointments?.professionals?.color ?? null,
      services: (r.appointments?.appointment_services ?? [])
        .map((s) => s.services?.name)
        .filter((n): n is string => Boolean(n)),
      notes: r.notes,
    };
  });

  // La profesional se guarda aparte del detalle porque sólo la usamos para
  // agrupar; el id no aporta nada en la fila del desglose.
  const proById = new Map<string, { id: string; name: string; color: string }>();
  const proOfPayment = new Map<string, string>();
  for (const r of rows) {
    const pro = r.appointments?.professionals;
    if (!pro) continue;
    proById.set(pro.id, { id: pro.id, name: pro.full_name, color: pro.color });
    proOfPayment.set(r.id, pro.id);
  }

  const total = details.reduce((acc, d) => acc + d.amount, 0);

  // ── Totales por método
  const methodAgg = new Map<PaymentMethod, { amount: number; count: number }>();
  for (const d of details) {
    const prev = methodAgg.get(d.method) ?? { amount: 0, count: 0 };
    methodAgg.set(d.method, {
      amount: prev.amount + d.amount,
      count: prev.count + 1,
    });
  }

  const byMethod: MethodTotal[] = METHOD_ORDER.filter((m) =>
    methodAgg.has(m),
  ).map((m) => {
    const agg = methodAgg.get(m)!;
    return {
      method: m,
      label: PAYMENT_METHOD_LABEL[m],
      amount: agg.amount,
      count: agg.count,
      pct: total > 0 ? (agg.amount / total) * 100 : 0,
    };
  });

  // ── Día a día
  const dayAgg = new Map<string, DayRow>();
  for (const d of details) {
    const key = basis === "turno" ? (d.appointmentDay ?? d.paidDay) : d.paidDay;
    let row = dayAgg.get(key);
    if (!row) {
      row = { date: key, total: 0, count: 0, byMethod: emptyByMethod() };
      dayAgg.set(key, row);
    }
    row.total += d.amount;
    row.count += 1;
    row.byMethod[d.method] += d.amount;
  }
  const byDay = Array.from(dayAgg.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // ── Desglose por método
  const breakdowns: MethodBreakdown[] = byMethod.map((m) => {
    const payments = details
      .filter((d) => d.method === m.method)
      .sort(
        (a, b) =>
          b.paidDay.localeCompare(a.paidDay) ||
          b.paidTime.localeCompare(a.paidTime),
      );

    const proAgg = new Map<string, { amount: number; count: number }>();
    for (const p of payments) {
      const proId = proOfPayment.get(p.id);
      if (!proId) continue;
      const prev = proAgg.get(proId) ?? { amount: 0, count: 0 };
      proAgg.set(proId, {
        amount: prev.amount + p.amount,
        count: prev.count + 1,
      });
    }

    return {
      method: m.method,
      label: m.label,
      amount: m.amount,
      count: m.count,
      pct: m.pct,
      average: m.count > 0 ? m.amount / m.count : 0,
      payments,
      byProfessional: Array.from(proAgg.entries())
        .map(([id, agg]) => {
          const pro = proById.get(id)!;
          return {
            id,
            name: pro.name,
            color: pro.color,
            amount: agg.amount,
            count: agg.count,
          };
        })
        .sort((a, b) => b.amount - a.amount),
    };
  });

  const largest = details.reduce<IncomeDetail | null>(
    (best, d) => (best === null || d.amount > best.amount ? d : best),
    null,
  );

  return {
    month,
    basis,
    total,
    count: details.length,
    byMethod,
    byDay,
    breakdowns,
    largest,
  };
}
