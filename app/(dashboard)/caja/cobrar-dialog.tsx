"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
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
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validations/payments";
import { recordPaymentAction } from "./actions";
import type { UnpaidAppointment } from "./types";

type Line = { method: PaymentMethod; amount: number };

export function CobrarDialog({
  open,
  onOpenChange,
  appointment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: UnpaidAppointment | null;
}) {
  const [lines, setLines] = useState<Line[]>([
    { method: "cash", amount: 0 },
  ]);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  // Seña / adelanto ya cobrado al agendar. El saldo a cobrar hoy es el total
  // menos la seña; la seña se registra aparte (con su método) en el server.
  const deposit = appointment?.deposit_amount ?? 0;
  const balanceDue = appointment
    ? Math.max(0, appointment.total_price - deposit)
    : 0;

  // Reset when opened with a new appointment: prefill the balance as efectivo
  useEffect(() => {
    if (open && appointment) {
      const due = Math.max(0, appointment.total_price - (appointment.deposit_amount ?? 0));
      setLines([{ method: "cash", amount: due }]);
      setNotes("");
    }
  }, [open, appointment]);

  const total = useMemo(
    () => lines.reduce((acc, l) => acc + (Number.isFinite(l.amount) ? l.amount : 0), 0),
    [lines],
  );

  // Diferencia contra el saldo (lo que falta cobrar hoy), no contra el total.
  const diff = appointment ? total - balanceDue : 0;

  function addLine() {
    setLines((prev) => [...prev, { method: "transfer", amount: 0 }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function onSubmit() {
    if (!appointment) return;
    const validLines = lines.filter((l) => l.amount > 0);
    // Con seña, el saldo puede ser cero (la seña cubre todo): en ese caso se
    // registra sólo la seña en el server. Sin seña, hace falta al menos una línea.
    if (validLines.length === 0 && deposit <= 0) {
      toast.error("El total cobrado tiene que ser mayor a cero.");
      return;
    }

    const formData = new FormData();
    formData.set("appointmentId", appointment.id);
    formData.set("lines", JSON.stringify(validLines));
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await recordPaymentAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Cobro registrado.");
        onOpenChange(false);
      }
    });
  }

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrar turno</DialogTitle>
          <DialogDescription>
            {appointment.client?.full_name} · con{" "}
            {appointment.professional?.full_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Service summary */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Servicios del turno
            </div>
            {appointment.services.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between text-sm"
              >
                <span>{s.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCurrency(s.price)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-medium border-t pt-1.5 mt-1.5">
              <span>Total servicios</span>
              <span className="tabular-nums">
                {formatCurrency(appointment.total_price)}
              </span>
            </div>
            {deposit > 0 ? (
              <>
                <div className="flex items-center justify-between text-sm text-emerald-700">
                  <span>
                    Seña recibida
                    {appointment.deposit_method ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {PAYMENT_METHOD_LABEL[appointment.deposit_method]}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    −{formatCurrency(deposit)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                  <span>Saldo a cobrar</span>
                  <span className="tabular-nums">
                    {formatCurrency(balanceDue)}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          {/* Payment lines */}
          <div className="space-y-2">
            <Label>Líneas de pago</Label>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_36px] gap-2">
                  <Select
                    value={line.method}
                    onValueChange={(v) =>
                      updateLine(idx, { method: v as PaymentMethod })
                    }
                  >
                    <SelectTrigger>
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
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={500}
                    value={line.amount || ""}
                    placeholder="0"
                    onChange={(e) =>
                      updateLine(idx, {
                        amount: Number(e.target.value) || 0,
                      })
                    }
                    className="text-right tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="size-4 text-destructive" />
                    <span className="sr-only">Quitar</span>
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addLine}
              className="w-full"
            >
              <Plus className="size-4" />
              Agregar otro método (split)
            </Button>
          </div>

          {/* Total + diff */}
          <div className="rounded-md border p-3 bg-muted/20 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{deposit > 0 ? "Cobrado ahora (saldo)" : "Total cobrado"}</span>
              <span className="tabular-nums font-medium">
                {formatCurrency(total)}
              </span>
            </div>
            {deposit > 0 ? (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>+ Seña ya recibida</span>
                  <span className="tabular-nums">{formatCurrency(deposit)}</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t pt-1.5 mt-1.5">
                  <span>Total registrado</span>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(total + deposit)}
                  </span>
                </div>
              </>
            ) : null}
            {diff !== 0 ? (
              <div
                className={`flex items-center justify-between text-xs ${diff > 0 ? "text-amber-700" : "text-rose-700"}`}
              >
                <span>
                  {diff > 0
                    ? deposit > 0
                      ? "Cobraste más que el saldo"
                      : "Cobraste más del precio del turno"
                    : deposit > 0
                      ? "Falta para cubrir el saldo"
                      : "Falta para cubrir el precio"}
                </span>
                <span className="tabular-nums">
                  {diff > 0 ? "+" : ""}
                  {formatCurrency(diff)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Propina, descuento aplicado, etc."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Cobrando…
              </>
            ) : (
              "Registrar cobro"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
