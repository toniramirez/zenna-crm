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

  // Reset when opened with a new appointment: prefill total as efectivo
  useEffect(() => {
    if (open && appointment) {
      setLines([{ method: "cash", amount: appointment.total_price }]);
      setNotes("");
    }
  }, [open, appointment]);

  const total = useMemo(
    () => lines.reduce((acc, l) => acc + (Number.isFinite(l.amount) ? l.amount : 0), 0),
    [lines],
  );

  const diff = appointment ? total - appointment.total_price : 0;

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
    if (lines.length === 0) {
      toast.error("Cargá al menos una línea de pago.");
      return;
    }
    if (total <= 0) {
      toast.error("El total cobrado tiene que ser mayor a cero.");
      return;
    }
    const validLines = lines.filter((l) => l.amount > 0);
    if (validLines.length === 0) {
      toast.error("Al menos una línea tiene que tener importe.");
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
              <span>Total cobrado</span>
              <span className="tabular-nums font-medium">
                {formatCurrency(total)}
              </span>
            </div>
            {diff !== 0 ? (
              <div
                className={`flex items-center justify-between text-xs ${diff > 0 ? "text-amber-700" : "text-rose-700"}`}
              >
                <span>
                  {diff > 0
                    ? "Cobraste más del precio del turno"
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
