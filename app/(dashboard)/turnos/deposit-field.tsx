"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Banknote, Landmark } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";

const OTHER_METHODS = PAYMENT_METHODS.filter(
  (m) => m.value !== "cash" && m.value !== "transfer",
);

/**
 * "¿Se cobró seña?" del formulario de turno. Se usa en la agenda y en el
 * "Nuevo turno" del CRM para que las dos pregunten lo mismo.
 *
 * La seña entra a la caja del día en que se cobra (no a la del turno): lo
 * resuelve el server con `deposit_paid_on`, acá sólo se avisa.
 */
export function DepositField({
  id,
  amount,
  method,
  onAmountChange,
  onMethodChange,
  totalPrice,
  paidOn = null,
  compact = false,
}: {
  id: string;
  amount: number;
  method: PaymentMethod;
  onAmountChange: (amount: number) => void;
  onMethodChange: (method: PaymentMethod) => void;
  totalPrice: number;
  /** Día de caja en que ya se registró la seña (al editar un turno). */
  paidOn?: string | null;
  compact?: boolean;
}) {
  // "Sí" sin monto todavía tiene que mostrar el input. Con monto > 0 la
  // respuesta es sí aunque el diálogo se haya abierto con la seña ya cargada.
  const [answeredYes, setAnsweredYes] = useState(false);
  const charged = answeredYes || amount > 0;
  const balance = Math.max(0, totalPrice - amount);

  function answer(yes: boolean) {
    setAnsweredYes(yes);
    if (!yes) {
      onAmountChange(0);
      onMethodChange("cash");
    }
  }

  const labelClass = compact ? "text-xs" : undefined;
  const otherSelected = method !== "cash" && method !== "transfer";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className={labelClass}>¿Se cobró seña?</Label>
        <div
          role="radiogroup"
          aria-label="¿Se cobró seña?"
          className="inline-flex rounded-md border p-0.5 bg-muted/40"
        >
          {[
            { yes: false, label: "No" },
            { yes: true, label: "Sí" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={charged === o.yes}
              onClick={() => answer(o.yes)}
              className={cn(
                "px-3 py-1 text-sm rounded-[5px] transition-colors",
                charged === o.yes
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {charged ? (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={id} className="text-xs text-muted-foreground">
              Monto de la seña
            </Label>
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              step={500}
              value={amount || ""}
              placeholder="0"
              autoFocus={answeredYes && amount === 0}
              onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
              className="text-right tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">
              ¿Cómo se abonó?
            </span>
            <div className="grid grid-cols-2 gap-2">
              <MethodButton
                active={method === "cash"}
                onClick={() => onMethodChange("cash")}
                icon={<Banknote className="size-4" />}
                label="Efectivo"
              />
              <MethodButton
                active={method === "transfer"}
                onClick={() => onMethodChange("transfer")}
                icon={<Landmark className="size-4" />}
                label="Transferencia"
              />
            </div>
            <Select
              value={otherSelected ? method : ""}
              onValueChange={(v) => onMethodChange(v as PaymentMethod)}
            >
              <SelectTrigger
                className={cn(
                  "w-full h-8 text-xs",
                  otherSelected && "border-foreground/40 font-medium",
                )}
              >
                <SelectValue placeholder="Otro medio (tarjeta, MercadoPago…)" />
              </SelectTrigger>
              <SelectContent>
                {OTHER_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {amount > 0 ? (
            <div className="space-y-0.5 text-xs text-muted-foreground border-t pt-2">
              {totalPrice > 0 ? (
                <p className="flex justify-between">
                  <span>Falta pagar en el turno</span>
                  <strong className="text-foreground tabular-nums">
                    {formatCurrency(balance)}
                  </strong>
                </p>
              ) : null}
              <p>
                {paidOn
                  ? `Registrada en la caja del ${format(parseISO(paidOn + "T12:00:00"), "EEEE d/M", { locale: es })}.`
                  : "Entra en la caja de hoy al guardar el turno."}
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-700">
              Ingresá el monto. Sin monto, el turno se guarda sin seña.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        active
          ? "border-foreground bg-background font-medium shadow-sm"
          : "bg-background/50 text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
