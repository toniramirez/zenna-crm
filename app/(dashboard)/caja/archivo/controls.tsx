import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { dayRangeISO, ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import type { Database } from "@/types/database.types";

type PaymentMethod = Database["public"]["Enums"]["payment_method"];

type UnchargedRow = {
  id: string;
  starts_at: string;
  deposit_amount: number;
  deposit_method: PaymentMethod | null;
  clients: { full_name: string } | null;
  professionals: { full_name: string } | null;
  appointment_services: { services: { name: string } | null }[];
};

type DroppedDepositRow = {
  id: string;
  starts_at: string;
  status: Database["public"]["Enums"]["appointment_status"];
  deposit_amount: number;
  deposit_method: PaymentMethod | null;
  deposit_paid_on: string | null;
  clients: { full_name: string } | null;
};

const caja = (day: string, today: string) =>
  day === today ? "/caja" : `/caja?date=${day}`;

/**
 * Controles: lo que tiene que estar y no está. Cada uno lleva directo a la
 * caja del día donde se arregla.
 *
 *   · Turnos que ya pasaron y nunca se cobraron (de cualquier mes: un cobro
 *     olvidado no deja de importar porque cambió el mes).
 *   · Señas de turnos cancelados o que no vinieron, del mes: la plata entró;
 *     hay que decidir si se devolvió o queda a favor.
 *   · Días del mes con efectivo y sin cierre.
 */
export async function CajaControls({
  firstDay,
  lastDay,
  today,
  openCashDays,
}: {
  firstDay: string;
  lastDay: string;
  today: string;
  /** Días del mes que ya pasaron, con efectivo y sin cierre. */
  openCashDays: string[];
}) {
  const supabase = await createClient();

  const [unchargedResult, droppedResult] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        `
        id, starts_at, deposit_amount, deposit_method,
        clients ( full_name ),
        professionals ( full_name ),
        appointment_services ( services ( name ) )
      `,
      )
      .lt("starts_at", dayRangeISO(today).start)
      .is("charged_at", null)
      .not("status", "in", '("cancelled","no_show")')
      .order("starts_at", { ascending: false })
      .limit(100),
    supabase
      .from("appointments")
      .select(
        "id, starts_at, status, deposit_amount, deposit_method, deposit_paid_on, clients ( full_name )",
      )
      .in("status", ["cancelled", "no_show"])
      .gt("deposit_amount", 0)
      .gte("starts_at", dayRangeISO(firstDay).start)
      .lte("starts_at", dayRangeISO(lastDay).end)
      .order("starts_at", { ascending: false }),
  ]);

  if (unchargedResult.error) {
    console.error("[caja/archivo] uncharged query failed:", unchargedResult.error);
  }
  if (droppedResult.error) {
    console.error("[caja/archivo] dropped deposits query failed:", droppedResult.error);
  }

  const uncharged = (unchargedResult.data as UnchargedRow[] | null) ?? [];
  const dropped = (droppedResult.data as DroppedDepositRow[] | null) ?? [];
  const loadError =
    unchargedResult.error?.message ?? droppedResult.error?.message ?? null;

  const allGood =
    !loadError &&
    uncharged.length === 0 &&
    dropped.length === 0 &&
    openCashDays.length === 0;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Controles</h2>

      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            No pudimos correr los controles.
          </p>
          <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
            {loadError}
          </p>
        </div>
      ) : null}

      {allGood ? (
        <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" />
          Está todo: no hay turnos sin cobrar, señas sin resolver ni cajas con
          efectivo sin cerrar.
        </div>
      ) : null}

      {uncharged.length > 0 ? (
        <ControlCard
          title={`${uncharged.length} turno${uncharged.length === 1 ? "" : "s"} que ya pasaron sin cobrar`}
          hint="Si se atendieron, cobralos desde la caja de su día. Si no vinieron, marcalos como cancelado o no vino en la agenda."
        >
          {uncharged.map((a) => {
            const day = formatInTimeZone(a.starts_at, ZENNA_TZ, "yyyy-MM-dd");
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {a.clients?.full_name ?? "Sin clienta"}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {a.appointment_services
                        .map((s) => s.services?.name)
                        .filter(Boolean)
                        .join(" + ") || "—"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatInTimeZone(a.starts_at, ZENNA_TZ, "EEE d/M/yy HH:mm", {
                      locale: es,
                    })}
                    {a.professionals ? ` · con ${a.professionals.full_name}` : ""}
                    {Number(a.deposit_amount) > 0
                      ? ` · seña ${formatCurrency(a.deposit_amount)}`
                      : ""}
                  </div>
                </div>
                <Link
                  href={caja(day, today)}
                  className="shrink-0 text-xs font-medium underline underline-offset-2"
                >
                  Ir a la caja
                </Link>
              </li>
            );
          })}
        </ControlCard>
      ) : null}

      {dropped.length > 0 ? (
        <ControlCard
          title={`${dropped.length} seña${dropped.length === 1 ? "" : "s"} de turnos cancelados o que no vinieron`}
          hint="La plata entró. Si se la devolviste, abrí el turno y poné que no se cobró seña: sale de la caja del día en que entró."
        >
          {dropped.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {a.clients?.full_name ?? "Sin clienta"}
                  <span className="font-normal text-rose-700">
                    {" "}
                    · {a.status === "cancelled" ? "cancelado" : "no vino"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Turno del{" "}
                  {formatInTimeZone(a.starts_at, ZENNA_TZ, "EEE d/M", { locale: es })}
                  {a.deposit_paid_on
                    ? ` · seña recibida el ${format(parseISO(a.deposit_paid_on + "T12:00:00"), "d/M", { locale: es })}`
                    : ""}
                  {a.deposit_method
                    ? ` por ${PAYMENT_METHOD_LABEL[a.deposit_method].toLowerCase()}`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {formatCurrency(a.deposit_amount)}
              </span>
            </li>
          ))}
        </ControlCard>
      ) : null}

      {openCashDays.length > 0 ? (
        <ControlCard
          title={`${openCashDays.length} día${openCashDays.length === 1 ? "" : "s"} con efectivo sin cerrar`}
          hint="Contá el efectivo de ese día y cerrá la caja."
        >
          {openCashDays.map((day) => (
            <li key={day} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm capitalize-first">
                {format(parseISO(day + "T12:00:00"), "EEEE d 'de' MMMM", {
                  locale: es,
                })}
              </span>
              <Link
                href={caja(day, today)}
                className="shrink-0 text-xs font-medium underline underline-offset-2"
              >
                Ir a la caja
              </Link>
            </li>
          ))}
        </ControlCard>
      ) : null}
    </section>
  );
}

function ControlCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4">
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-700" />
        <div className="flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">
          Ver
        </span>
        <span className="text-xs text-muted-foreground hidden group-open:inline">
          Ocultar
        </span>
      </summary>
      <ul className="divide-y border-t mx-4 mb-2">{children}</ul>
    </details>
  );
}
