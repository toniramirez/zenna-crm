"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
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
import type { DayAppointment } from "./types";

// Sin método por defecto: un cobro mal clasificado descuadra la caja (el
// efectivo se cuenta en el cajón, la transferencia se busca en el banco).
type Line = { method: PaymentMethod | null; amount: number };

/**
 * Cierra la venta del turno: precio final − seña ya recibida = lo que falta
 * pagar hoy. La seña no se vuelve a cobrar ni se mueve de día: ya está en la
 * caja del día en que entró.
 */
export function CobrarDialog({
  open,
  onOpenChange,
  appointment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: DayAppointment | null;
}) {
  const [finalPrice, setFinalPrice] = useState("");
  const [lines, setLines] = useState<Line[]>([{ method: null, amount: 0 }]);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  const deposit = appointment?.deposit_amount ?? 0;
  const price = finalPrice === "" ? null : Number(finalPrice);
  const balance = price === null ? null : Math.max(0, price - deposit);
  const coveredByDeposit = balance === 0 && deposit > 0;

  // Al abrir: el precio de lista como sugerencia (muchos servicios lo tienen
  // en $0 porque se define al atender; ahí queda vacío para que lo carguen).
  useEffect(() => {
    if (open && appointment) {
      const list = appointment.total_price;
      setFinalPrice(list > 0 ? String(list) : "");
      setLines([
        {
          method: null,
          amount: list > 0 ? Math.max(0, list - appointment.deposit_amount) : 0,
        },
      ]);
      setNotes("");
    }
  }, [open, appointment]);

  const linesTotal = useMemo(
    () =>
      lines.reduce(
        (acc, l) => acc + (Number.isFinite(l.amount) ? l.amount : 0),
        0,
      ),
    [lines],
  );
  const diff = balance === null ? 0 : linesTotal - balance;

  function onPriceChange(value: string) {
    setFinalPrice(value);
    // Con una sola línea, la vamos llevando a lo que falta: es el caso común.
    if (lines.length === 1) {
      const due = value === "" ? 0 : Math.max(0, Number(value) - deposit);
      setLines([{ ...lines[0], amount: due }]);
    }
  }

  function payAllWith(method: PaymentMethod) {
    setLines([{ method, amount: balance ?? 0 }]);
  }

  function addLine() {
    setLines((prev) => [...prev, { method: null, amount: 0 }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function onSubmit() {
    if (!appointment) return;
    if (price === null || !Number.isFinite(price) || price < 0) {
      toast.error("Cargá el precio final de la venta.");
      return;
    }
    // Si la seña cubre todo no se cobra nada más, aunque quede algún monto
    // tipeado de antes en las líneas (que en ese caso ni se ven).
    const validLines = coveredByDeposit
      ? []
      : lines.filter((l) => l.amount > 0);
    if (validLines.some((l) => !l.method)) {
      toast.error("Elegí cómo pagó (efectivo, transferencia…).");
      return;
    }
    if (validLines.length === 0 && (balance ?? 0) > 0) {
      toast.error(`Falta cobrar ${formatCurrency(balance ?? 0)}.`);
      return;
    }
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
      } else if (result?.fieldErrors) {
        toast.error(
          Object.values(result.fieldErrors)[0] ?? "Revisá los datos del cobro.",
        );
      } else if (result?.success) {
        toast.success(
          validLines.length === 0 ? "Venta cerrada." : "Cobro registrado.",
        );
        onOpenChange(false);
      }
    });
  }

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar turno</DialogTitle>
          <DialogDescription>
            {appointment.client?.full_name} · con{" "}
            {appointment.professional?.full_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Servicios */}
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
                  {s.price > 0 ? formatCurrency(s.price) : "a definir"}
                </span>
              </div>
            ))}
          </div>

          {/* Precio final − seña = falta pagar */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_150px] items-center gap-3">
              <Label htmlFor="final-price">Precio final de la venta</Label>
              <Input
                id="final-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={500}
                value={finalPrice}
                placeholder="0"
                autoFocus={appointment.total_price <= 0}
                onChange={(e) => onPriceChange(e.target.value)}
                className="text-right tabular-nums"
              />
            </div>
            {deposit > 0 ? (
              <div className="flex items-center justify-between text-sm text-emerald-700">
                <span>
                  − Seña ya recibida
                  <span className="text-muted-foreground">
                    {appointment.deposit_method
                      ? ` · ${PAYMENT_METHOD_LABEL[appointment.deposit_method]}`
                      : ""}
                    {appointment.deposit_paid_on
                      ? ` · ${format(parseISO(appointment.deposit_paid_on + "T12:00:00"), "d/M", { locale: es })}`
                      : ""}
                  </span>
                </span>
                <span className="tabular-nums">−{formatCurrency(deposit)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-md bg-foreground text-background px-4 py-3">
              <span className="text-sm">Falta pagar</span>
              <span className="text-2xl font-semibold tabular-nums">
                {balance === null ? "—" : formatCurrency(balance)}
              </span>
            </div>
            {price !== null && deposit > price ? (
              <p className="text-xs text-amber-700">
                La seña es mayor que el precio: queda un saldo a favor de la
                clienta de {formatCurrency(deposit - price)}.
              </p>
            ) : null}
          </div>

          {coveredByDeposit ? (
            <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 text-sm text-emerald-900">
              La seña cubre todo. Cerrá la venta sin cobrar nada más.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>¿Cómo paga?</Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => payAllWith("transfer")}
                    disabled={balance === null}
                  >
                    Todo transferencia
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => payAllWith("cash")}
                    disabled={balance === null}
                  >
                    Todo efectivo
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_130px_36px] gap-2"
                  >
                    <Select
                      value={line.method ?? ""}
                      onValueChange={(v) =>
                        updateLine(idx, { method: v as PaymentMethod })
                      }
                    >
                      <SelectTrigger
                        className={
                          !line.method && line.amount > 0
                            ? "border-amber-500"
                            : undefined
                        }
                      >
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
                Pagó con dos métodos
              </Button>

              {balance !== null && Math.abs(diff) >= 0.01 ? (
                <p
                  className={`flex justify-between text-xs ${diff > 0 ? "text-amber-700" : "text-rose-700"}`}
                >
                  <span>
                    {diff > 0
                      ? "Estás cobrando más de lo que falta"
                      : "Todavía falta cubrir"}
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(Math.abs(diff))}
                  </span>
                </p>
              ) : null}
            </div>
          )}

          {price !== null ? (
            <div className="rounded-md border p-3 bg-muted/20 space-y-1 text-sm">
              {deposit > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Seña (ya en la caja de su día)</span>
                  <span className="tabular-nums">{formatCurrency(deposit)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-muted-foreground">
                <span>Entra hoy a la caja</span>
                <span className="tabular-nums">
                  {formatCurrency(coveredByDeposit ? 0 : linesTotal)}
                </span>
              </div>
              <div className="flex justify-between font-medium border-t pt-1.5 mt-1.5">
                <span>Venta del turno</span>
                <span className="tabular-nums">
                  {formatCurrency(deposit + (coveredByDeposit ? 0 : linesTotal))}
                </span>
              </div>
            </div>
          ) : null}

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
                Guardando…
              </>
            ) : coveredByDeposit ? (
              "Cerrar venta"
            ) : (
              "Registrar cobro"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
