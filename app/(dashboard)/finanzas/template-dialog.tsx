"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  expenseTemplateSchema,
  type ExpenseTemplateInput,
} from "@/lib/validations/expense-templates";
import { EXPENSE_CATEGORIES } from "@/lib/validations/expenses";
import { PAYMENT_METHODS } from "@/lib/validations/payments";
import {
  createTemplateAction,
  updateTemplateAction,
} from "./actions";
import type { ExpenseTemplateRow } from "./types";

export function TemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ExpenseTemplateRow | null;
}) {
  const [isPending, startTransition] = useTransition();
  const editing = template !== null;

  const form = useForm<ExpenseTemplateInput>({
    resolver: zodResolver(expenseTemplateSchema),
    defaultValues: {
      name: "",
      category: "otro",
      defaultPaymentMethod: "transfer",
      defaultAmount: null,
      dueDay: 1,
      notes: "",
      active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: template?.name ?? "",
        category: template?.category ?? "otro",
        defaultPaymentMethod: template?.default_payment_method ?? "",
        defaultAmount: template?.default_amount
          ? Number(template.default_amount)
          : null,
        dueDay: template?.due_day ?? 1,
        notes: template?.notes ?? "",
        active: template?.active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  function onSubmit(values: ExpenseTemplateInput) {
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("category", values.category);
    formData.set("defaultPaymentMethod", values.defaultPaymentMethod ?? "");
    formData.set(
      "defaultAmount",
      values.defaultAmount != null ? String(values.defaultAmount) : "",
    );
    formData.set("dueDay", String(values.dueDay));
    formData.set("notes", values.notes ?? "");
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updateTemplateAction(template.id, formData)
        : await createTemplateAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.fieldErrors) {
        for (const [name, message] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof ExpenseTemplateInput, { message });
        }
      } else if (result?.success) {
        toast.success(editing ? "Plantilla actualizada." : "Plantilla creada.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar gasto fijo" : "Nuevo gasto fijo"}
          </DialogTitle>
          <DialogDescription>
            La plantilla guarda el concepto recurrente (alquiler, luz, sueldo).
            El monto lo cargás cada vez que la pagás.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Alquiler, Luz, Sueldo Sol…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="defaultPaymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Método</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="defaultAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto sug.</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={500}
                        placeholder="Opcional"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.valueAsNumber;
                          field.onChange(Number.isFinite(v) ? v : null);
                        }}
                        className="tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vence día</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || 1)
                        }
                        className="tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Activa</FormLabel>
                    <FormDescription>
                      Solo aparecen las plantillas activas en el panel.
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
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Guardando…
                  </>
                ) : editing ? (
                  "Guardar cambios"
                ) : (
                  "Crear plantilla"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewTemplateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        Nueva plantilla
      </Button>
      <TemplateDialog open={open} onOpenChange={setOpen} template={null} />
    </>
  );
}
