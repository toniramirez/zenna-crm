"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Loader2, Lock, LockOpen } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { closeCajaAction, reopenCajaAction } from "./actions";
import { diffClass, formatDiff } from "./day-totals";
import type { CashClosingRow } from "./types";

/**
 * Cierre de caja: al final del día se cuenta el efectivo del cajón y se
 * compara contra lo que el sistema espera. El cierre queda guardado en el
 * archivo de cajas con la diferencia.
 */
export function CloseCajaCard({
  cajaDate,
  isOwner,
  isFuture,
  expectedCash,
  cashIncome,
  cashExpenses,
  transferIncome,
  closing,
  loadError,
}: {
  cajaDate: string;
  isOwner: boolean;
  isFuture: boolean;
  expectedCash: number;
  cashIncome: number;
  cashExpenses: number;
  transferIncome: number;
  closing: CashClosingRow | null;
  loadError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isReopening, startReopen] = useTransition();

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">
          No pudimos cargar el cierre de esta caja.
        </p>
        <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
          {loadError}
        </p>
      </div>
    );
  }

  function reopen() {
    if (!confirm("¿Reabrir esta caja? Se borra el cierre guardado.")) return;
    startReopen(async () => {
      const result = await reopenCajaAction(cajaDate);
      if (result.error) toast.error(result.error);
      else toast.success("Caja reabierta.");
    });
  }

  if (closing) {
    const diff = Number(closing.counted_cash) - Number(closing.expected_cash);
    // El cierre es una foto: si después se cargó un cobro o un egreso en
    // efectivo para este día, lo que se espera hoy ya no es lo que se contó.
    const changedSinceClose =
      Math.abs(Number(closing.expected_cash) - expectedCash) >= 0.01;
    return (
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-emerald-700" />
            <div>
              <div className="text-sm font-semibold">Caja cerrada</div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(closing.closed_at), "d/M HH:mm", { locale: es })}
              </div>
            </div>
          </div>
          {isOwner ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                Corregir conteo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={reopen}
                disabled={isReopening}
              >
                <LockOpen className="size-4" />
                Reabrir
              </Button>
            </div>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Esperado</dt>
            <dd className="tabular-nums font-medium">
              {formatCurrency(closing.expected_cash)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Contado</dt>
            <dd className="tabular-nums font-medium">
              {formatCurrency(closing.counted_cash)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Diferencia</dt>
            <dd className={`tabular-nums font-semibold ${diffClass(diff)}`}>
              {formatDiff(diff)}
            </dd>
          </div>
        </dl>

        {closing.notes ? (
          <p className="text-xs text-muted-foreground">Nota: {closing.notes}</p>
        ) : null}

        {changedSinceClose ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="size-3.5 mt-px shrink-0" />
            Hubo movimientos después del cierre: ahora se esperan{" "}
            {formatCurrency(expectedCash)} en efectivo.
            {isOwner ? " Corregí el conteo si hace falta." : " Avisale a la dueña."}
          </p>
        ) : null}

        <CloseDialog
          key={closing.closed_at}
          open={open}
          onOpenChange={setOpen}
          cajaDate={cajaDate}
          expectedCash={expectedCash}
          cashIncome={cashIncome}
          cashExpenses={cashExpenses}
          transferIncome={transferIncome}
          initialCounted={Number(closing.counted_cash)}
          initialNotes={closing.notes ?? ""}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <LockOpen className="size-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">Caja abierta</div>
          <div className="text-xs text-muted-foreground">
            {isFuture
              ? "Se puede cerrar cuando llegue el día."
              : `Al final del día contá el efectivo: se esperan ${formatCurrency(expectedCash)}.`}
          </div>
        </div>
      </div>
      <Button size="sm" onClick={() => setOpen(true)} disabled={isFuture}>
        <Lock className="size-4" />
        Cerrar caja
      </Button>
      <CloseDialog
        open={open}
        onOpenChange={setOpen}
        cajaDate={cajaDate}
        expectedCash={expectedCash}
        cashIncome={cashIncome}
        cashExpenses={cashExpenses}
        transferIncome={transferIncome}
        initialCounted={null}
        initialNotes=""
      />
    </div>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  cajaDate,
  expectedCash,
  cashIncome,
  cashExpenses,
  transferIncome,
  initialCounted,
  initialNotes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cajaDate: string;
  expectedCash: number;
  cashIncome: number;
  cashExpenses: number;
  transferIncome: number;
  initialCounted: number | null;
  initialNotes: string;
}) {
  const [counted, setCounted] = useState(
    initialCounted === null ? "" : String(initialCounted),
  );
  const [notes, setNotes] = useState(initialNotes);
  const [isPending, startTransition] = useTransition();

  const countedNum = counted === "" ? null : Number(counted);
  const diff = countedNum === null ? null : countedNum - expectedCash;

  function onSubmit() {
    if (countedNum === null || !Number.isFinite(countedNum)) {
      toast.error("Ingresá cuánto efectivo contaste.");
      return;
    }
    if (diff !== null && Math.abs(diff) >= 0.01 && !notes.trim()) {
      toast.error("Hay diferencia: dejá una nota explicando qué pasó.");
      return;
    }
    const formData = new FormData();
    formData.set("cajaDate", cajaDate);
    formData.set("countedCash", counted);
    formData.set("notes", notes);
    startTransition(async () => {
      const result = await closeCajaAction(formData);
      if (result.error) {
        toast.error(result.error);
      } else if (result.fieldErrors) {
        toast.error(Object.values(result.fieldErrors)[0] ?? "Revisá los datos.");
      } else {
        toast.success("Caja cerrada y guardada en el archivo.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cerrar caja</DialogTitle>
          <DialogDescription>
            Contá el efectivo del cajón y cargalo. Las transferencias no se
            cuentan acá: controlalas en el banco ({formatCurrency(transferIncome)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Cobrado en efectivo</span>
              <span className="tabular-nums">{formatCurrency(cashIncome)}</span>
            </div>
            {cashExpenses > 0 ? (
              <div className="flex justify-between text-rose-700">
                <span>Egresos en efectivo</span>
                <span className="tabular-nums">−{formatCurrency(cashExpenses)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold border-t pt-1.5 mt-1.5">
              <span>Tendría que haber</span>
              <span className="tabular-nums">{formatCurrency(expectedCash)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="counted-cash">Efectivo contado</Label>
            <Input
              id="counted-cash"
              type="number"
              inputMode="decimal"
              min={0}
              step={100}
              value={counted}
              placeholder="0"
              autoFocus
              onChange={(e) => setCounted(e.target.value)}
              className="text-right tabular-nums text-lg"
            />
            {diff !== null ? (
              <p className={`text-sm font-medium ${diffClass(diff)}`}>
                {Math.abs(diff) < 0.01
                  ? "Coincide con lo esperado."
                  : diff > 0
                    ? `Sobran ${formatCurrency(diff)}`
                    : `Faltan ${formatCurrency(-diff)}`}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="close-notes">Notas</Label>
            <Textarea
              id="close-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Obligatorio si hay diferencia"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Guardar cierre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
