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
}: {
  appointments: UnpaidAppointment[];
}) {
  const [target, setTarget] = useState<UnpaidAppointment | null>(null);
  const [open, setOpen] = useState(false);

  function openCobrar(a: UnpaidAppointment) {
    setTarget(a);
    setOpen(true);
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
