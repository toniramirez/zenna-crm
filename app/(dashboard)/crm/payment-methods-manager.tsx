"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  paymentMethodSchema,
  type PaymentMethodInput,
} from "@/lib/validations/crm-config";
import {
  createPaymentMethodAction,
  deletePaymentMethodAction,
  updatePaymentMethodAction,
} from "./config-actions";
import type { PaymentMethod } from "./config-types";

export function PaymentMethodsManager({
  methods,
}: {
  methods: PaymentMethod[];
}) {
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(method: PaymentMethod) {
    setEditing(method);
    setOpen(true);
  }

  function handleDelete(method: PaymentMethod) {
    if (!confirm(`¿Archivar el medio de pago "${method.label}"?`)) return;
    startTransition(async () => {
      const result = await deletePaymentMethodAction(method.id);
      if (result.error) toast.error(result.error);
      else toast.success("Medio de pago archivado.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Medios de pago disponibles al armar un presupuesto. El recargo
          se aplica al precio base; usá un valor negativo para descuentos
          (ej: transferencia -5%).
        </p>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Nuevo medio
        </Button>
      </div>

      {methods.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          Todavía no hay medios de pago cargados.
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Nombre</th>
                <th className="text-right font-medium px-3 py-2">Recargo</th>
                <th className="text-right font-medium px-3 py-2">Cuotas</th>
                <th className="text-right font-medium px-3 py-2 w-24">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {methods.map((m) => (
                <tr
                  key={m.id}
                  className={m.active ? "" : "text-muted-foreground"}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-3.5 opacity-50" />
                      <span className="font-medium">{m.label}</span>
                      {!m.active ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0"
                        >
                          Archivado
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(m.surcharge_percent) === 0
                      ? "—"
                      : `${Number(m.surcharge_percent) > 0 ? "+" : ""}${Number(m.surcharge_percent)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.installments ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => openEdit(m)}
                      title="Editar"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {m.active ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleDelete(m)}
                        title="Archivar"
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentMethodDialog
        open={open}
        onOpenChange={setOpen}
        method={editing}
      />
    </div>
  );
}

function PaymentMethodDialog({
  open,
  onOpenChange,
  method,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method: PaymentMethod | null;
}) {
  const editing = method !== null;
  const [isPending, startTransition] = useTransition();

  const form = useForm<PaymentMethodInput>({
    resolver: zodResolver(paymentMethodSchema),
    defaultValues: {
      label: "",
      surchargePercent: 0,
      installments: null,
      active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        label: method?.label ?? "",
        surchargePercent: method ? Number(method.surcharge_percent) : 0,
        installments: method?.installments ?? null,
        active: method?.active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method?.id]);

  function onSubmit(values: PaymentMethodInput) {
    const formData = new FormData();
    formData.set("label", values.label);
    formData.set("surchargePercent", String(values.surchargePercent));
    if (values.installments !== null) {
      formData.set("installments", String(values.installments));
    }
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updatePaymentMethodAction(method.id, formData)
        : await createPaymentMethodAction(formData);
      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) {
        for (const [name, msg] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof PaymentMethodInput, { message: msg });
        }
      } else if (result.success) {
        toast.success(
          editing ? "Medio de pago actualizado." : "Medio de pago creado.",
        );
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar medio de pago" : "Nuevo medio de pago"}
          </DialogTitle>
          <DialogDescription>
            Lo vas a ver al armar un presupuesto. El recargo se aplica al
            precio base.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Tarjeta 3 cuotas" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="surchargePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recargo (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.5"
                        min={-100}
                        max={500}
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Negativo = descuento
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="installments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuotas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        placeholder="—"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.valueAsNumber;
                          field.onChange(Number.isFinite(v) ? v : null);
                        }}
                      />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Vacío para 1 pago
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Activo</FormLabel>
                    <FormDescription>
                      Solo los activos aparecen al armar un presupuesto.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {editing ? "Guardar cambios" : "Crear medio de pago"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
