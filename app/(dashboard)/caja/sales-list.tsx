import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
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
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/validations/payments";
import { type DayAppointment, saleBreakdown } from "./types";

const SHORT: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.short]),
) as Record<PaymentMethod, string>;

/**
 * Ventas del día: los turnos de este día ya cobrados. La venta es del día del
 * turno aunque la seña haya entrado antes (a la caja de su propio día): acá se
 * ve de dónde salió cada peso.
 */
export function SalesList({ sales }: { sales: DayAppointment[] }) {
  if (sales.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Todavía no se cobró ningún turno de este día.
        </p>
      </div>
    );
  }

  const totals = sales.reduce(
    (acc, a) => {
      const b = saleBreakdown(a);
      return {
        deposit: acc.deposit + b.deposit,
        charged: acc.charged + b.charged,
        total: acc.total + b.total,
      };
    },
    { deposit: 0, charged: 0, total: 0 },
  );

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">Turno</TableHead>
              <TableHead>Clienta</TableHead>
              <TableHead>Servicios</TableHead>
              <TableHead className="text-right">Seña</TableHead>
              <TableHead className="text-right">Cobrado al atender</TableHead>
              <TableHead className="text-right">Venta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((a) => {
              const b = saleBreakdown(a);
              const deposits = a.payments.filter((p) => p.is_deposit);
              const charges = a.payments.filter((p) => !p.is_deposit);
              return (
                <TableRow key={a.id}>
                  <TableCell className="tabular-nums text-sm">
                    {formatInTimeZone(a.starts_at, ZENNA_TZ, "HH:mm")}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {a.client?.full_name ?? "—"}
                    </span>
                    {a.professional ? (
                      <span className="block text-xs text-muted-foreground">
                        con {a.professional.full_name}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[220px]">
                    {a.services.map((s) => s.name).join(" + ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.deposit > 0 ? (
                      <>
                        {formatCurrency(b.deposit)}
                        <span className="block text-xs text-muted-foreground">
                          {deposits
                            .map(
                              (p) =>
                                `${SHORT[p.method]} · ${format(parseISO(p.caja_date + "T12:00:00"), "d/M", { locale: es })}`,
                            )
                            .join(", ")}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {charges.length > 0 ? (
                      <>
                        {formatCurrency(b.charged)}
                        <span className="block text-xs text-muted-foreground">
                          {[...new Set(charges.map((p) => SHORT[p.method]))].join(
                            " + ",
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        cubierto por la seña
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(b.total)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>
                {sales.length} venta{sales.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(totals.deposit)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(totals.charged)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {formatCurrency(totals.total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {totals.deposit > 0 ? (
        <p className="text-xs text-muted-foreground">
          De las ventas del día, {formatCurrency(totals.deposit)} son señas
          (cada una suma en la caja del día en que entró) y{" "}
          {formatCurrency(totals.charged)} se cobraron al atender.
        </p>
      ) : null}
    </div>
  );
}
