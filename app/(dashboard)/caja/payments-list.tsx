import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import type { PaymentWithDetails } from "./types";

export function PaymentsList({
  payments,
}: {
  payments: PaymentWithDetails[];
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sin cobros registrados hoy todavía.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Hora</TableHead>
            <TableHead>Clienta</TableHead>
            <TableHead>Profesional</TableHead>
            <TableHead>Servicios</TableHead>
            <TableHead>Método</TableHead>
            <TableHead className="text-right">Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => {
            const appt = p.appointments;
            const services =
              appt?.appointment_services
                .map((s) => s.services?.name)
                .filter(Boolean)
                .join(" + ") || "—";
            return (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums text-sm">
                  {format(new Date(p.paid_at), "HH:mm", { locale: es })}
                </TableCell>
                <TableCell className="font-medium">
                  {appt?.clients?.full_name ?? "—"}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-sm">
                    {appt?.professionals ? (
                      <>
                        <span
                          className="size-2.5 rounded-full"
                          style={{
                            backgroundColor: appt.professionals.color,
                          }}
                        />
                        {appt.professionals.full_name}
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[260px]">
                  {services}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs font-normal">
                    {PAYMENT_METHOD_LABEL[p.method]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(p.amount)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
