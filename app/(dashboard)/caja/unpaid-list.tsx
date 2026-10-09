"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/validations/payments";
import { CobrarDialog } from "./cobrar-dialog";
import type { DayAppointment } from "./types";

export function UnpaidList({
  appointments,
  loadError = null,
}: {
  appointments: DayAppointment[];
  /** Mensaje de error si la consulta falló. Nunca lo disfrazamos de lista vacía. */
  loadError?: string | null;
}) {
  const [target, setTarget] = useState<DayAppointment | null>(null);
  const [open, setOpen] = useState(false);

  function openCobrar(a: DayAppointment) {
    setTarget(a);
    setOpen(true);
  }

  // Si la consulta falló no sabemos si hay pendientes o no. Decir "no hay"
  // sería mentir y hacer que se pierda un cobro.
  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-medium text-destructive">
          No pudimos cargar los turnos pendientes de cobro.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Puede haber turnos sin cobrar que no se están mostrando. Recargá la
          página y, si sigue igual, avisá.
        </p>
        <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
          {loadError}
        </p>
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No hay turnos pendientes de cobro.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Horario</TableHead>
              <TableHead>Clienta</TableHead>
              <TableHead>Profesional</TableHead>
              <TableHead>Servicios</TableHead>
              <TableHead>Seña</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="w-[110px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="tabular-nums text-sm">
                  {formatInTimeZone(a.starts_at, ZENNA_TZ, "HH:mm", { locale: es })}
                </TableCell>
                <TableCell className="font-medium">
                  {a.client?.full_name ?? "—"}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-sm">
                    {a.professional ? (
                      <>
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: a.professional.color }}
                        />
                        {a.professional.full_name}
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[280px]">
                  {a.services.map((s) => s.name).join(" + ") || "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {a.deposit_amount > 0 ? (
                    <>
                      <span className="tabular-nums font-medium text-emerald-700">
                        {formatCurrency(a.deposit_amount)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {methodShort(a.deposit_method)}
                        {a.deposit_paid_on
                          ? ` · ${format(parseISO(a.deposit_paid_on + "T12:00:00"), "d/M", { locale: es })}`
                          : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.total_price > 0 ? (
                    <>
                      {formatCurrency(a.total_price)}
                      {a.deposit_amount > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          falta{" "}
                          {formatCurrency(
                            Math.max(0, a.total_price - a.deposit_amount),
                          )}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      a definir
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Button size="sm" onClick={() => openCobrar(a)}>
                    <Wallet className="size-4" />
                    Cobrar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CobrarDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTarget(null);
        }}
        appointment={target}
      />
    </>
  );
}

function methodShort(method: DayAppointment["deposit_method"]): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.short ?? "";
}
