"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
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
import { formatCurrency } from "@/lib/format";
import { CobrarDialog } from "./cobrar-dialog";
import type { UnpaidAppointment } from "./types";

export function UnpaidList({
  appointments,
  loadError = null,
}: {
  appointments: UnpaidAppointment[];
  /** Mensaje de error si la consulta falló. Nunca lo disfrazamos de lista vacía. */
  loadError?: string | null;
}) {
  const [target, setTarget] = useState<UnpaidAppointment | null>(null);
  const [open, setOpen] = useState(false);

  function openCobrar(a: UnpaidAppointment) {
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
          No hay turnos pendientes de cobro hoy.
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
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-[110px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="tabular-nums text-sm">
                  {format(new Date(a.starts_at), "HH:mm", { locale: es })}
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
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(a.total_price)}
                  {a.deposit_amount > 0 ? (
                    <span className="block text-xs font-normal text-emerald-700">
                      seña −{formatCurrency(a.deposit_amount)} · saldo{" "}
                      {formatCurrency(
                        Math.max(0, a.total_price - a.deposit_amount),
                      )}
                    </span>
                  ) : null}
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
