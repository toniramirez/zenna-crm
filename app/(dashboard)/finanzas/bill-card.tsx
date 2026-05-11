"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  Check,
  Loader2,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { payTemplateAction, unpayTemplateAction } from "./actions";
import type { ExpenseRow, ExpenseTemplateRow } from "./types";

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Status = "paid" | "pending" | "overdue" | "due_soon";

function relativeDueLabel(dueDate: Date, today: Date, status: Status) {
  if (status === "paid") return null;
  const diff = differenceInCalendarDays(dueDate, today);
  if (diff === 0) return "Vence hoy";
  if (diff > 0) return `Vence en ${diff} d`;
  return `Venció hace ${Math.abs(diff)}d`;
}

export function BillCard({
  template,
  period,
  existing,
}: {
  template: ExpenseTemplateRow;
  period: string; // YYYY-MM-DD (first day of month)
  existing: ExpenseRow | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState<number>(
    template.default_amount ? Number(template.default_amount) : 0,
  );
  const [paidDate, setPaidDate] = useState<string>(todayIsoDate());
  const [method, setMethod] = useState<PaymentMethod>(
    template.default_payment_method ?? "transfer",
  );
  const [notes, setNotes] = useState("");

  // Reset form when collapsing
  useEffect(() => {
    if (!expanded) {
      setAmount(template.default_amount ? Number(template.default_amount) : 0);
      setPaidDate(todayIsoDate());
      setMethod(template.default_payment_method ?? "transfer");
      setNotes("");
    }
  }, [expanded, template]);

  // Compute status
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const periodDate = parseISO(period + "T12:00:00");
  const dueDate = new Date(
    periodDate.getFullYear(),
    periodDate.getMonth(),
    template.due_day,
  );
  let status: Status;
  if (existing) status = "paid";
  else if (today > dueDate) status = "overdue";
  else if (differenceInCalendarDays(dueDate, today) <= 3) status = "due_soon";
  else status = "pending";

  function handlePay() {
    if (amount <= 0) {
      toast.error("Cargá el monto pagado.");
      return;
    }
    const formData = new FormData();
    formData.set("templateId", template.id);
    formData.set("period", period);
    formData.set("amount", String(amount));
    formData.set("expenseDate", paidDate);
    formData.set("paymentMethod", method);
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await payTemplateAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Pago registrado.");
        setExpanded(false);
      }
    });
  }

  function handleUnpay() {
    if (!existing) return;
    if (!confirm("¿Quitar el pago registrado de esta plantilla en este mes?"))
      return;
    startTransition(async () => {
      const result = await unpayTemplateAction(template.id, period);
      if (result?.error) toast.error(result.error);
      else toast.success("Pago revertido.");
    });
  }

  const relLabel = relativeDueLabel(dueDate, today, status);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col",
        status === "overdue" && "border-rose-300",
        status === "paid" && "border-emerald-300",
        status === "due_soon" && "border-amber-300",
      )}
    >
      <div className="p-4 space-y-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <h3 className="font-semibold truncate">{template.name}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className="text-xs font-normal">
                {EXPENSE_CATEGORY_LABEL[template.category]}
              </Badge>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <CalendarIcon className="size-3" />
                Vence día {template.due_day}
              </span>
            </div>
          </div>
          <StatusBadge status={status} label={relLabel} />
        </div>
      </div>

      <div className="border-t bg-muted/10 p-3">
        {existing ? (
          <PaidBlock
            existing={existing}
            isPending={isPending}
            onUnpay={handleUnpay}
          />
        ) : expanded ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Monto pagado
                </Label>
                <Input
                  type="number"
                  min={0}
                  step={500}
                  value={amount || ""}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                  className="tabular-nums"
                  autoFocus
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Fecha de pago
                </Label>
                <Input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Método
              </Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Notas (opcional)
              </Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalles, recargo, etc."
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handlePay}
                disabled={isPending}
                className="flex-1"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    Marcar como pagado
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setExpanded(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setExpanded(true)}
          >
            <Wallet className="size-4" />
            Registrar pago
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: Status;
  label: string | null;
}) {
  if (status === "paid") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-300">
        Pagado
      </Badge>
    );
  }
  if (status === "overdue") {
    return (
      <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 border-rose-300">
        {label}
      </Badge>
    );
  }
  if (status === "due_soon") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-300">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {label ?? "Pendiente"}
    </Badge>
  );
}

function PaidBlock({
  existing,
  isPending,
  onUnpay,
}: {
  existing: ExpenseRow;
  isPending: boolean;
  onUnpay: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex flex-col min-w-0">
        <span className="font-medium tabular-nums">
          {formatCurrency(existing.amount)}
        </span>
        <span className="text-xs text-muted-foreground">
          {format(
            parseISO(existing.expense_date + "T12:00:00"),
            "d 'de' MMM yyyy",
            { locale: es },
          )}
          {existing.payment_method ? (
            <>
              {" "}
              · {PAYMENT_METHOD_LABEL[existing.payment_method]}
            </>
          ) : null}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={onUnpay}
        disabled={isPending}
        title="Quitar pago"
      >
        <Trash2 className="size-3.5 text-destructive" />
        <span className="sr-only">Quitar pago</span>
      </Button>
    </div>
  );
}
