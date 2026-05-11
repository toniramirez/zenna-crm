"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Loader2, Trash2, Wallet } from "lucide-react";
import { useState, useTransition } from "react";
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
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/validations/payments";
import {
  payProfessionalAction,
  unpayProfessionalAction,
} from "./actions";
import type { ProfessionalPayout } from "./professional-payouts";
import type { ExpenseRow } from "./types";

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ProfessionalPayoutCard({
  payout,
  period,
  salonNet,
}: {
  payout: ProfessionalPayout;
  period: string;
  salonNet: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState<number>(payout.totalDue);
  const [paidDate, setPaidDate] = useState<string>(todayIsoDate());
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [notes, setNotes] = useState("");

  const paid = payout.existingPayment !== null;

  function openForm() {
    setAmount(payout.totalDue);
    setPaidDate(todayIsoDate());
    setMethod("transfer");
    setNotes("");
    setExpanded(true);
  }

  function handlePay() {
    if (amount <= 0) {
      toast.error("El monto tiene que ser mayor a cero.");
      return;
    }
    const formData = new FormData();
    formData.set("professionalId", payout.professional.id);
    formData.set("period", period);
    formData.set("amount", String(amount));
    formData.set("expenseDate", paidDate);
    formData.set("paymentMethod", method);
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await payProfessionalAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Pago registrado.");
        setExpanded(false);
      }
    });
  }

  function handleUnpay() {
    if (!payout.existingPayment) return;
    if (
      !confirm(
        `¿Revertir el pago de ${payout.professional.full_name}? Las comisiones del mes vuelven a quedar pendientes.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await unpayProfessionalAction(
        payout.professional.id,
        period,
      );
      if (result?.error) toast.error(result.error);
      else toast.success("Pago revertido.");
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col",
        paid && "border-emerald-300",
        !paid && payout.totalDue > 0 && "border-amber-300",
      )}
    >
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="size-3 rounded-full border shrink-0"
              style={{ backgroundColor: payout.professional.color }}
              aria-hidden
            />
            <h3 className="font-semibold truncate">
              {payout.professional.full_name}
            </h3>
          </div>
          {paid ? (
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-300">
              Pagado
            </Badge>
          ) : payout.totalDue > 0 ? (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-300">
              A pagar
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Sin saldo
            </Badge>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          <BreakdownRow
            label={`Bruto (${payout.professional.commission_rate}%)`}
            value={payout.grossOwed}
            hint={
              payout.paymentsAttributed > 0
                ? `s/ ${formatCurrency(payout.paymentsAttributed)} cobrados en sus servicios`
                : "sin cobros atribuidos este mes"
            }
            muted={payout.paymentsAttributed <= 0}
          />
          <BreakdownRow
            label={`Neto (${payout.professional.commission_rate_net}%)`}
            value={payout.netShare}
            hint={
              salonNet > 0
                ? `s/ ${formatCurrency(salonNet)} de ganancia`
                : "salón sin ganancia este mes"
            }
            muted={salonNet <= 0}
          />
          <div className="flex items-baseline justify-between pt-1.5 border-t mt-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Total
            </span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(payout.totalDue)}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/10 p-3">
        {paid && payout.existingPayment ? (
          <PaidBlock
            existing={payout.existingPayment}
            isPending={isPending}
            onUnpay={handleUnpay}
          />
        ) : expanded ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Monto a pagar
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
                placeholder="Detalle del pago, ajustes, etc."
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
                    Confirmar pago
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
            onClick={openForm}
            disabled={payout.totalDue <= 0}
          >
            <Wallet className="size-4" />
            {payout.totalDue > 0 ? "Pagar" : "Sin saldo a pagar"}
          </Button>
        )}
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: number;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <div className={cn("text-sm", muted && "text-muted-foreground")}>
          {label}
        </div>
        {hint ? (
          <div className="text-[10px] text-muted-foreground leading-tight">
            {hint}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
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
            <> · {PAYMENT_METHOD_LABEL[existing.payment_method]}</>
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
