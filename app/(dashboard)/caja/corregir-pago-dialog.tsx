"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZENNA_TZ } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { correctPaymentsAction } from "./actions";
import type { DayAppointment } from "./types";

function dayLabel(dateStr: string): string {
  return format(parseISO(dateStr + "T12:00:00"), "d/M", { locale: es });
}

/**
 * Corrige los pagos de una venta ya cerrada: cada pago (la seña y lo cobrado
 * al atender) con su método y su importe.
 *
 *   · El método se corrige siempre: se cargó efectivo y era transferencia.
 *   · El importe, sólo el mismo día en que se cobró: es para el error de
 *     tipeo del momento, no para rehacer ventas de otros días.
 *
 * Corregir mueve plata entre el cajón y el banco (o cambia cuánta hay), así
 * que en una caja ya cerrada sólo lo hace la dueña.
 *
 * Arranca de cero con cada venta: quien lo usa le pone `key` con el turno.
 */
export function CorregirPagoDialog({
  open,
  onOpenChange,
  sale,
  today,
  isOwner,
  closedCajaDates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: DayAppointment | null;
  /** "YYYY-MM-DD" de hoy en Argentina: el único día en que se corrige el importe. */
  today: string;
  isOwner: boolean;
  /** Días de caja ya cerrados entre los pagos de las ventas. */
  closedCajaDates: string[];
}) {
  /** Sólo lo que se tocó, por id de pago. */
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  if (!sale) return null;

  const closed = new Set(closedCajaDates);
  // La seña primero: es la que entró antes.
  const rows = [...sale.payments]
    .sort(
      (a, b) =>
        Number(b.is_deposit) - Number(a.is_deposit) ||
        a.paid_at.localeCompare(b.paid_at),
    )
    .map((p) => {
      const method = methods[p.id] ?? p.method;
      const amountText = amounts[p.id] ?? String(Number(p.amount));
      const amount = amountText === "" ? Number.NaN : Number(amountText);
      const isClosed = closed.has(p.caja_date);
      return {
        payment: p,
        method,
        amountText,
        amount,
        isClosed,
        locked: isClosed && !isOwner,
        paidToday:
          formatInTimeZone(p.paid_at, ZENNA_TZ, "yyyy-MM-dd") === today,
        changed: method !== p.method || amount !== Number(p.amount),
      };
    });

  const changes = rows.filter((r) => r.changed);
  const before = rows.reduce((acc, r) => acc + Number(r.payment.amount), 0);
  const after = rows.reduce(
    (acc, r) => acc + (Number.isFinite(r.amount) ? r.amount : 0),
    0,
  );
  const amountFixed = rows.some((r) => !r.paidToday && !r.locked);

  function onSubmit() {
    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }
    if (changes.some((r) => !Number.isFinite(r.amount) || r.amount <= 0)) {
      toast.error("Cada pago tiene que tener importe.");
      return;
    }
    startTransition(async () => {
      const result = await correctPaymentsAction(
        changes.map((r) => ({
          id: r.payment.id,
          method: r.method,
          amount: r.amount,
        })),
      );
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Pago corregido.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corregir pago</DialogTitle>
          <DialogDescription>
            {sale.client?.full_name ?? "Sin clienta"}
            {sale.services.length > 0
              ? ` · ${sale.services.map((s) => s.name).join(" + ")}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta venta no tiene pagos cargados.
          </p>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => {
              const p = r.payment;
              const editAmount = r.paidToday && !r.locked;
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_130px] items-center gap-3 text-sm">
                    <span>
                      {p.is_deposit ? "Seña" : "Cobro"}
                      <span className="text-muted-foreground">
                        {" "}
                        · caja del {dayLabel(p.caja_date)}
                      </span>
                    </span>
                    {editAmount ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={500}
                        value={r.amountText}
                        placeholder="0"
                        aria-label={`Importe de ${p.is_deposit ? "la seña" : "el cobro"}`}
                        disabled={isPending}
                        onChange={(e) =>
                          setAmounts((prev) => ({
                            ...prev,
                            [p.id]: e.target.value,
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    ) : (
                      <span className="text-right tabular-nums font-medium">
                        {formatCurrency(p.amount)}
                      </span>
                    )}
                  </div>
                  <Select
                    value={r.method}
                    onValueChange={(v) =>
                      setMethods((prev) => ({
                        ...prev,
                        [p.id]: v as PaymentMethod,
                      }))
                    }
                    disabled={r.locked || isPending}
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
                  {r.locked ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3 shrink-0" />
                      La caja del {dayLabel(p.caja_date)} ya se cerró: sólo la
                      dueña puede corregirlo.
                    </p>
                  ) : r.isClosed && r.changed ? (
                    <p className="text-xs text-amber-700">
                      La caja del {dayLabel(p.caja_date)} ya se cerró: cambia
                      lo que tenía que haber. Revisá el conteo de ese día.
                    </p>
                  ) : null}
                </div>
              );
            })}

            {Math.abs(after - before) >= 0.01 ? (
              <div className="flex justify-between rounded-md border bg-muted/20 p-3 text-sm font-medium">
                <span>Venta del turno</span>
                <span className="tabular-nums">
                  <span className="font-normal text-muted-foreground line-through">
                    {formatCurrency(before)}
                  </span>{" "}
                  {formatCurrency(after)}
                </span>
              </div>
            ) : null}

            {amountFixed ? (
              <p className="text-xs text-muted-foreground">
                El importe sólo se corrige el mismo día en que se cobró.
              </p>
            ) : null}
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
