"use client";

import {
  CalendarClock,
  CalendarOff,
  MoreHorizontal,
  Pencil,
  Power,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleProfessionalActiveAction } from "./actions";
import { ProfessionalDialog } from "./professional-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { TimeOffDialog } from "./time-off-dialog";
import type { ProfessionalRow } from "./types";

export function ProfessionalsTable({
  professionals,
}: {
  professionals: ProfessionalRow[];
}) {
  const [target, setTarget] = useState<ProfessionalRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openEdit(p: ProfessionalRow) {
    setTarget(p);
    setEditOpen(true);
  }
  function openSchedule(p: ProfessionalRow) {
    setTarget(p);
    setScheduleOpen(true);
  }
  function openTimeOff(p: ProfessionalRow) {
    setTarget(p);
    setTimeOffOpen(true);
  }

  function handleToggle(p: ProfessionalRow) {
    startTransition(async () => {
      const result = await toggleProfessionalActiveAction(p.id, !p.active);
      if (result?.error) toast.error(result.error);
      else
        toast.success(
          p.active ? "Profesional desactivada." : "Profesional activada.",
        );
    });
  }

  if (professionals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
        <p className="text-base font-medium">
          Todavía no hay profesionales cargadas
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Cargá tus estilistas y coloristas con su color de identificación,
          horario semanal y comisión. Después aparecen como columnas en la
          grilla horaria.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Profesional</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {professionals.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span
                    className="block size-4 rounded-full border"
                    style={{ backgroundColor: p.color }}
                    aria-label={`Color ${p.color}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{p.full_name}</TableCell>
                <TableCell className="tabular-nums">
                  {p.phone ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(p.commission_rate)}%
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(p.commission_rate_net)}%
                </TableCell>
                <TableCell>
                  {p.active ? (
                    <Badge variant="secondary">Activa</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inactiva
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                        <span className="sr-only">Acciones</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p)}>
                        <Pencil className="size-4" />
                        Editar datos
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openSchedule(p)}>
                        <CalendarClock className="size-4" />
                        Horario semanal
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openTimeOff(p)}>
                        <CalendarOff className="size-4" />
                        Días libres
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggle(p)}>
                        <Power className="size-4" />
                        {p.active ? "Desactivar" : "Activar"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ProfessionalDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setTarget(null);
        }}
        professional={target}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={(o) => {
          setScheduleOpen(o);
          if (!o) setTarget(null);
        }}
        professional={target}
      />
      <TimeOffDialog
        open={timeOffOpen}
        onOpenChange={(o) => {
          setTimeOffOpen(o);
          if (!o) setTarget(null);
        }}
        professional={target}
      />
    </>
  );
}
