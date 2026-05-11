"use client";

import { MoreHorizontal, Pencil, Power, Receipt } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import { toggleTemplateActiveAction } from "./actions";
import { PayTemplateDialog } from "./pay-template-dialog";
import { TemplateDialog } from "./template-dialog";
import type { ExpenseTemplateRow } from "./types";

export function TemplatesList({
  templates,
}: {
  templates: ExpenseTemplateRow[];
}) {
  const [target, setTarget] = useState<ExpenseTemplateRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openEdit(t: ExpenseTemplateRow) {
    setTarget(t);
    setEditOpen(true);
  }
  function openPay(t: ExpenseTemplateRow) {
    setTarget(t);
    setPayOpen(true);
  }

  function handleToggle(t: ExpenseTemplateRow) {
    startTransition(async () => {
      const result = await toggleTemplateActiveAction(t.id, !t.active);
      if (result?.error) toast.error(result.error);
      else
        toast.success(
          t.active ? "Plantilla desactivada." : "Plantilla activada.",
        );
    });
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-16 text-center">
        <p className="text-base font-medium">
          Todavía no hay plantillas de gastos fijos
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Cargá los gastos recurrentes del local (alquiler, luz, gas, sueldos,
          marketing…). El monto lo ingresás cada mes al pagar.
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
              <TableHead>Concepto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="text-right">Monto sugerido</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[160px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs font-normal">
                    {EXPENSE_CATEGORY_LABEL[t.category]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.default_payment_method
                    ? PAYMENT_METHOD_LABEL[t.default_payment_method]
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {t.default_amount ? formatCurrency(t.default_amount) : "—"}
                </TableCell>
                <TableCell>
                  {t.active ? (
                    <Badge variant="secondary">Activa</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Archivada
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <Button
                      size="sm"
                      onClick={() => openPay(t)}
                      disabled={!t.active}
                    >
                      <Receipt className="size-4" />
                      Pagar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Acciones</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggle(t)}>
                          <Power className="size-4" />
                          {t.active ? "Desactivar" : "Activar"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TemplateDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setTarget(null);
        }}
        template={target}
      />
      <PayTemplateDialog
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          if (!o) setTarget(null);
        }}
        template={target}
      />
    </>
  );
}
