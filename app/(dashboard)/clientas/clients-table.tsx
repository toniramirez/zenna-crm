"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { ClientDialog } from "./client-dialog";
import type { ClientRow } from "./types";

export function ClientsTable({
  clients,
  query,
}: {
  clients: ClientRow[];
  query: string;
}) {
  const [target, setTarget] = useState<ClientRow | null>(null);
  const [open, setOpen] = useState(false);

  function openEdit(c: ClientRow) {
    setTarget(c);
    setOpen(true);
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
        <p className="text-base font-medium">
          {query
            ? `Sin resultados para "${query}"`
            : "Todavía no hay clientas cargadas"}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {query
            ? "Probá con otro término o limpiá el buscador."
            : "Cargá tu primera clienta con el botón de arriba. Después la vas a poder asignar a un turno."}
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
              <TableHead>Clienta</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead className="text-right">Visitas</TableHead>
              <TableHead className="text-right">Última visita</TableHead>
              <TableHead className="text-right">Total gastado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{c.full_name}</span>
                    {c.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 4).map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {t}
                          </Badge>
                        ))}
                        {c.tags.length > 4 ? (
                          <span className="text-xs text-muted-foreground">
                            +{c.tags.length - 4}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    {c.phone ? <span>{c.phone}</span> : null}
                    {c.email ? (
                      <span className="text-muted-foreground text-xs">
                        {c.email}
                      </span>
                    ) : null}
                    {!c.phone && !c.email ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.total_visits}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {c.last_visit_at
                    ? format(new Date(c.last_visit_at), "d MMM yyyy", {
                        locale: es,
                      })
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(c.total_spent)}
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
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        <Pencil className="size-4" />
                        Editar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ClientDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTarget(null);
        }}
        client={target}
      />
    </>
  );
}
