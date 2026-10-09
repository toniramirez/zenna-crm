import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import { METHOD_GROUPS, methodGroup } from "./day-totals";
import type { PaymentWithDetails } from "./types";

/**
 * Movimientos de dinero de la caja, en una tabla por grupo de método
 * (efectivo, transferencias, el resto) con su subtotal: cada grupo se controla
 * contra otra cosa — el cajón, el banco, los resúmenes — así que se leen por
 * separado. Cada fila dice qué fue: una seña (y para qué turno) o un cobro.
 */
export function PaymentsList({
  payments,
  cajaDate,
}: {
  payments: PaymentWithDetails[];
  /** "YYYY-MM-DD" de la caja que se está mirando. */
  cajaDate: string;
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No entró plata en esta caja todavía.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {METHOD_GROUPS.map((g) => {
        const rows = payments.filter((p) => methodGroup(p.method) === g.value);
        if (rows.length === 0) return null;
        const subtotal = rows.reduce((acc, p) => acc + Number(p.amount), 0);
        const showMethod = g.value === "other";
        return (
          <div key={g.value} className="space-y-1.5">
            <h3 className="text-sm font-semibold">
              {g.label}{" "}
              <span className="font-normal text-muted-foreground">
                · {rows.length} movimiento{rows.length === 1 ? "" : "s"} ·{" "}
                {g.hint.toLowerCase()}
              </span>
            </h3>
            <div className="rounded-md border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Hora</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Clienta</TableHead>
                    <TableHead>Servicios</TableHead>
                    {showMethod ? <TableHead>Método</TableHead> : null}
                    <TableHead className="text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <PaymentRow
                      key={p.id}
                      payment={p}
                      cajaDate={cajaDate}
                      showMethod={showMethod}
                    />
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={showMethod ? 5 : 4}>
                      Subtotal {g.label.toLowerCase()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatCurrency(subtotal)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaymentRow({
  payment: p,
  cajaDate,
  showMethod,
}: {
  payment: PaymentWithDetails;
  cajaDate: string;
  showMethod: boolean;
}) {
  const appt = p.appointments;
  const services =
    appt?.appointment_services
      .map((s) => s.services?.name)
      .filter(Boolean)
      .join(" + ") || "—";

  const turnoDay = appt
    ? formatInTimeZone(appt.starts_at, ZENNA_TZ, "yyyy-MM-dd")
    : null;
  const turnoWhen = appt
    ? turnoDay === cajaDate
      ? `turno de este día, ${formatInTimeZone(appt.starts_at, ZENNA_TZ, "HH:mm")}`
      : `turno del ${formatInTimeZone(appt.starts_at, ZENNA_TZ, "EEE d/M HH:mm", { locale: es })}`
    : null;
  const dropped =
    appt?.status === "cancelled" || appt?.status === "no_show";

  // Señas viejas que entraron como línea de un cobro tienen la hora del cobro,
  // no la de la seña: en ese caso no mostramos una hora que confunde.
  const paidDay = formatInTimeZone(p.paid_at, ZENNA_TZ, "yyyy-MM-dd");
  const hour =
    paidDay === cajaDate ? formatInTimeZone(p.paid_at, ZENNA_TZ, "HH:mm") : "—";

  return (
    <TableRow>
      <TableCell className="tabular-nums text-sm text-muted-foreground">
        {hour}
      </TableCell>
      <TableCell>
        {p.is_deposit ? (
          <Badge
            variant="outline"
            className="text-[11px] font-normal border-amber-500/50 text-amber-800"
          >
            Seña
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] font-normal">
            Cobro
          </Badge>
        )}
        {turnoWhen ? (
          <span className="block text-xs text-muted-foreground mt-0.5">
            {turnoWhen}
            {dropped ? (
              <span className="text-rose-700">
                {" "}
                · {appt?.status === "cancelled" ? "cancelado" : "no vino"}
              </span>
            ) : null}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-medium">
        {appt?.clients?.full_name ?? "—"}
        {appt?.professionals ? (
          <span className="block text-xs font-normal text-muted-foreground">
            con {appt.professionals.full_name}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[220px]">
        {services}
      </TableCell>
      {showMethod ? (
        <TableCell>
          <Badge variant="outline" className="text-xs font-normal">
            {PAYMENT_METHOD_LABEL[p.method]}
          </Badge>
        </TableCell>
      ) : null}
      <TableCell className="text-right tabular-nums font-medium">
        {formatCurrency(p.amount)}
      </TableCell>
    </TableRow>
  );
}
