import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
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
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import { METHOD_GROUPS, type MethodGroup, methodGroup } from "../day-totals";
import type { LedgerPayment } from "./data";

export type MovementType = "all" | "deposit" | "charge";

const TYPES: { value: MovementType; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "deposit", label: "Señas" },
  { value: "charge", label: "Cobros" },
];

/**
 * Libro de movimientos del mes: cada peso que entró, cuándo, cómo y por qué
 * turno. Es lo que se compara contra el extracto del banco y el cajón.
 */
export function MovementsLedger({
  payments,
  month,
  method,
  type,
}: {
  payments: LedgerPayment[];
  month: string;
  method: MethodGroup | "all";
  type: MovementType;
}) {
  const rows = payments.filter(
    (p) =>
      (method === "all" || methodGroup(p.method) === method) &&
      (type === "all" || (type === "deposit") === p.is_deposit),
  );
  const total = rows.reduce((acc, p) => acc + Number(p.amount), 0);

  const href = (m: string, t: string) => {
    const params = new URLSearchParams({ month, vista: "movimientos" });
    if (m !== "all") params.set("metodo", m);
    if (t !== "all") params.set("tipo", t);
    return `/caja/archivo?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterGroup
          options={[
            { value: "all", label: "Todos los métodos" },
            ...METHOD_GROUPS.map((g) => ({ value: g.value, label: g.label })),
          ]}
          active={method}
          href={(v) => href(v, type)}
        />
        <FilterGroup
          options={TYPES}
          active={type}
          href={(v) => href(method, v)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No hay movimientos con ese filtro.
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caja</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Clienta</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const appt = p.appointments;
                const dropped =
                  appt?.status === "cancelled" || appt?.status === "no_show";
                return (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      <Link
                        href={`/caja?date=${p.caja_date}`}
                        className="hover:underline capitalize-first"
                      >
                        {format(parseISO(p.caja_date + "T12:00:00"), "EEE d/M", {
                          locale: es,
                        })}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px] font-normal",
                          p.is_deposit && "border-amber-500/50 text-amber-800",
                        )}
                      >
                        {p.is_deposit ? "Seña" : "Cobro"}
                      </Badge>
                      {appt ? (
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          turno del{" "}
                          {formatInTimeZone(appt.starts_at, ZENNA_TZ, "d/M HH:mm")}
                          {dropped ? (
                            <span className="text-rose-700">
                              {" "}
                              · {appt.status === "cancelled" ? "cancelado" : "no vino"}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {appt?.clients?.full_name ?? "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate max-w-[220px]">
                        {appt?.appointment_services
                          .map((s) => s.services?.name)
                          .filter(Boolean)
                          .join(" + ") || ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {PAYMENT_METHOD_LABEL[p.method]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(p.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>
                  {rows.length} movimiento{rows.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {formatCurrency(total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  options,
  active,
  href,
}: {
  options: { value: T; label: string }[];
  active: T;
  href: (value: T) => string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border p-0.5 bg-muted/40">
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-[5px] transition-colors",
            active === o.value
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
