"use client";

import { MoreHorizontal, Pencil, Power } from "lucide-react";
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
import { formatCurrency, formatDuration } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/validations/services";
import { toggleServiceActiveAction } from "./actions";
import { ServiceDialog } from "./service-dialog";
import type { ServiceRow } from "./types";

export function ServicesTable({ services }: { services: ServiceRow[] }) {
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openEdit(service: ServiceRow) {
    setEditing(service);
    setDialogOpen(true);
  }

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditing(null);
  }

  function handleToggleActive(service: ServiceRow) {
    startTransition(async () => {
      const result = await toggleServiceActiveAction(service.id, !service.active);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(
          service.active ? "Servicio desactivado." : "Servicio activado.",
        );
      }
    });
  }

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
        <p className="text-base font-medium">Todavía no hay servicios cargados</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Cargá los servicios que ofrece la peluquería (corte, color, mechas,
          tratamientos, etc.) con duración y precio. Después los vas a poder
          asignar a turnos.
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
              <TableHead>Servicio</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">Duración</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{service.name}</span>
                    {service.description ? (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {service.description}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{CATEGORY_LABEL[service.category]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(service.duration_minutes)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(service.price)}
                </TableCell>
                <TableCell>
                  {service.active ? (
                    <Badge variant="secondary">Activo</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Archivado
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
                      <DropdownMenuItem onClick={() => openEdit(service)}>
                        <Pencil className="size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleToggleActive(service)}
                      >
                        <Power className="size-4" />
                        {service.active ? "Desactivar" : "Activar"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ServiceDialog
        open={dialogOpen}
        onOpenChange={handleDialogChange}
        service={editing}
      />
    </>
  );
}
