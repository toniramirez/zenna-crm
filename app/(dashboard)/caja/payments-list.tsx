import { format } from "date-fns";
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
 * Cobros de la caja, en una tabla por grupo de método (efectivo,
 * transferencias, el resto) con su subtotal: cada grupo se controla contra
 * otra cosa — el cajón, el banco, los resúmenes — así que se leen por separado.
 */
export function PaymentsList({
  payments,
  cajaDate,
}: {
  payments: PaymentWithDetails[];
  /** "YYYY-MM-DD" de la caja: para avisar cuando una seña es de un turno de otro día. */
  cajaDate: string;
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sin cobros registrados en esta caja todavía.
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
        return (
          <div key={g.value} className="space-y-1.5">
            <h3 className="text-sm font-semibold">
              {g.label}{" "}
              <span className="font-normal text-muted-foreground">
                · {rows.length} cobro{rows.length === 1 ? "" : "s"}
              </span>
            </h3>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">Hora</TableHead>
                    <TableHead>Clienta</TableHead>
                    <TableHead>Profesional</TableHead>
                    <TableHead>Servicios</TableHead>
                    {g.value === "other" ? <TableHead>Método</TableHead> : null}
                    <TableHead className="text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <PaymentRow
                      key={p.id}
                      payment={p}
                      cajaDate={cajaDate}
                      showMethod={g.value === "other"}
                    />
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={g.value === "other" ? 5 : 4}>
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

  // La seña cae en la caja del día en que se cobró; si el turno es otro día
  // lo decimos, para que nadie la busque en la caja equivocada.
  const turnoDay = appt
    ? formatInTimeZone(appt.starts_at, ZENNA_TZ, "yyyy-MM-dd")
    : null;
  const turnoLabel =
    p.is_deposit && appt && turnoDay !== cajaDate
      ? `turno del ${formatInTimeZone(appt.starts_at, ZENNA_TZ, "EEE d/M HH:mm", { locale: es })}`
      : null;

  return (
    <TableRow>
      <TableCell className="tabular-nums text-sm">
        {format(new Date(p.paid_at), "HH:mm", { locale: es })}
      </TableCell>
      <TableCell className="font-medium">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {appt?.clients?.full_name ?? "—"}
          {p.is_deposit ? (
            <Badge
              variant="outline"
              className="text-[10px] font-normal border-emerald-600/40 text-emerald-700"
            >
              Seña
            </Badge>
          ) : null}
        </span>
        {turnoLabel ? (
          <span className="block text-xs font-normal text-muted-foreground">
            {turnoLabel}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-2 text-sm">
          {appt?.professionals ? (
            <>
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: appt.professionals.color }}
              />
              {appt.professionals.full_name}
            </>
          ) : (
            "—"
          )}
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[240px]">
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
