"use client";

import { MoreHorizontal, Pencil, Power, Receipt } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PhoneGroup } from "@/components/dashboard/phone-screen";
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
import { cn } from "@/lib/utils";
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
      {/* En el teléfono la tabla de seis columnas no entra: cada plantilla
          es una fila, con "Pagar" y el menú a mano. */}
      <PhoneGroup className="mx-0 hidden phone:block">
        {templates.map((t) => (
          <li
            key={t.id}
            className={cn(
              "flex items-center gap-2 py-3 pr-2 pl-4",
              !t.active && "opacity-55",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[0.9375rem] font-medium">
                  {t.name}
                </span>
                <span className="shrink-0 text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
                  {t.default_amount ? formatCurrency(t.default_amount) : null}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[0.8125rem] text-[var(--wa-text-2)]">
                {[
                  EXPENSE_CATEGORY_LABEL[t.category],
                  t.default_payment_method
                    ? PAYMENT_METHOD_LABEL[t.default_payment_method]
                    : null,
                  t.active ? null : "Archivada",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {t.active ? (
              <button
                type="button"
                onClick={() => openPay(t)}
                className="h-8 shrink-0 rounded-full bg-[var(--wa-chip-on)] px-3.5 text-[0.8125rem] font-semibold text-[var(--wa-chip-on-text)] active:opacity-80"
              >
                Pagar
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Acciones de ${t.name}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] active:bg-[var(--wa-hover)]"
                >
                  <MoreHorizontal className="size-5" />
                </button>
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
          </li>
        ))}
      </PhoneGroup>

      <div className="rounded-md border bg-card phone:hidden">
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
