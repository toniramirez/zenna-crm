"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Lock } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { changePaymentMethodsAction } from "./actions";
import type { DayAppointment } from "./types";

function dayLabel(dateStr: string): string {
  return format(parseISO(dateStr + "T12:00:00"), "d/M", { locale: es });
}

/**
 * Corrige cómo se pagó una venta ya cerrada: cada pago (la seña y lo cobrado
 * al atender) con su método. El importe no se toca, sólo por dónde entró.
 * Cambiar el método mueve plata entre el cajón y el banco, así que en una caja
 * ya cerrada sólo lo hace la dueña.
 *
 * Arranca de cero con cada venta: quien lo usa le pone `key` con el turno.
 */
export function CambiarMetodoDialog({
  open,
  onOpenChange,
  sale,
  isOwner,
  closedCajaDates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: DayAppointment | null;
  isOwner: boolean;
  /** Días de caja ya cerrados entre los pagos de las ventas. */
  closedCajaDates: string[];
}) {
  /** Sólo los pagos que se tocaron: id → método elegido. */
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [isPending, startTransition] = useTransition();

  if (!sale) return null;

  const closed = new Set(closedCajaDates);
  // La seña primero: es la que entró antes.
  const payments = [...sale.payments].sort(
    (a, b) =>
      Number(b.is_deposit) - Number(a.is_deposit) ||
      a.paid_at.localeCompare(b.paid_at),
  );
  const changes = payments
    .filter((p) => methods[p.id] && methods[p.id] !== p.method)
    .map((p) => ({ id: p.id, method: methods[p.id] }));

  function onSubmit() {
    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const result = await changePaymentMethodsAction(changes);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Método de pago actualizado.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Método de pago</DialogTitle>
          <DialogDescription>
            {sale.client?.full_name ?? "Sin clienta"}
            {sale.services.length > 0
              ? ` · ${sale.services.map((s) => s.name).join(" + ")}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta venta no tiene pagos cargados.
          </p>
        ) : (
          <div className="space-y-4">
            {payments.map((p) => {
              const isClosed = closed.has(p.caja_date);
              const locked = isClosed && !isOwner;
              const changed = methods[p.id] && methods[p.id] !== p.method;
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {p.is_deposit ? "Seña" : "Cobro"}
                      <span className="text-muted-foreground">
                        {" "}
                        · caja del {dayLabel(p.caja_date)}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                  <Select
                    value={methods[p.id] ?? p.method}
                    onValueChange={(v) =>
                      setMethods((prev) => ({
                        ...prev,
                        [p.id]: v as PaymentMethod,
                      }))
                    }
                    disabled={locked || isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Método" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {locked ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3 shrink-0" />
                      La caja del {dayLabel(p.caja_date)} ya se cerró: sólo la
                      dueña puede cambiarlo.
                    </p>
                  ) : isClosed && changed ? (
                    <p className="text-xs text-amber-700">
                      La caja del {dayLabel(p.caja_date)} ya se cerró: cambia
                      el efectivo esperado. Revisá el conteo de ese día.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending || changes.length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
