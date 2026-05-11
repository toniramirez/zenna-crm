"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowRight, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import { PAYMENT_METHOD_LABEL } from "@/lib/validations/payments";
import { deleteExpenseAction } from "./actions";
import type { ExpenseRow } from "./types";

export function ExpensesList({
  expenses,
  canDelete,
  currentDate,
}: {
  expenses: ExpenseRow[];
  canDelete: boolean;
  currentDate: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar este egreso?")) return;
    startTransition(async () => {
      const result = await deleteExpenseAction(id);
      if (result?.error) toast.error(result.error);
      else toast.success("Egreso eliminado.");
    });
  }

  if (expenses.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sin egresos cargados este mes.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[90px]">Fecha</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Método</TableHead>
            <TableHead className="text-right">Importe</TableHead>
            {canDelete ? <TableHead className="w-[40px]"></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((e) => {
            const isCashFromOtherDay =
              e.payment_method === "cash" &&
              e.cash_source_date &&
              e.cash_source_date !== e.expense_date;
            const isTemplatePayment =
              !!e.template_id && e.cash_source_date === null;
            const affectsThisDay =
              e.payment_method === "cash" &&
              e.cash_source_date === currentDate;
            return (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums text-sm">
                  {format(parseISO(e.expense_date + "T12:00:00"), "d MMM", {
                    locale: es,
                  })}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs font-normal">
                    {EXPENSE_CATEGORY_LABEL[e.category]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    <span>
                      {e.description ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                    {isCashFromOtherDay && e.cash_source_date ? (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <ArrowRight className="size-3" />
                        Efectivo de la caja del{" "}
                        {format(
                          parseISO(e.cash_source_date + "T12:00:00"),
                          "d 'de' MMM",
                          { locale: es },
                        )}
                      </span>
                    ) : null}
                    {isTemplatePayment ? (
                      <span className="text-xs text-muted-foreground italic">
                        Gasto fijo · no afecta cajas
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {e.payment_method
                    ? PAYMENT_METHOD_LABEL[e.payment_method]
                    : "—"}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (affectsThisDay
                      ? "text-destructive font-medium"
                      : "text-muted-foreground")
                  }
                  title={
                    affectsThisDay
                      ? "Resta del efectivo a rendir de este día"
                      : "Egreso del mes, no afecta el efectivo a rendir de este día"
                  }
                >
                  −{formatCurrency(e.amount)}
                </TableCell>
                {canDelete ? (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => handleDelete(e.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                      <span className="sr-only">Eliminar</span>
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
