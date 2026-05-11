"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Receipt } from "lucide-react";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
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
  Form,
  FormControl,
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
import { EXPENSE_CATEGORY_LABEL } from "@/lib/validations/expenses";
import {
  payTemplateSchema,
  type PayTemplateInput,
} from "@/lib/validations/expense-templates";
import { PAYMENT_METHODS } from "@/lib/validations/payments";
import { payTemplateAction } from "./actions";
import type { ExpenseTemplateRow } from "./types";

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function PayTemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ExpenseTemplateRow | null;
}) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<PayTemplateInput>({
    resolver: zodResolver(payTemplateSchema),
    defaultValues: {
      templateId: "",
      amount: 0,
      expenseDate: todayIsoDate(),
      paymentMethod: "transfer",
      notes: "",
    },
  });

  useEffect(() => {
    if (open && template) {
      form.reset({
        templateId: template.id,
        amount: template.default_amount ? Number(template.default_amount) : 0,
        expenseDate: todayIsoDate(),
        paymentMethod: template.default_payment_method ?? "transfer",
        notes: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  function onSubmit(values: PayTemplateInput) {
    const formData = new FormData();
    formData.set("templateId", values.templateId);
    formData.set("amount", String(values.amount));
    formData.set("expenseDate", values.expenseDate);
    formData.set("paymentMethod", values.paymentMethod ?? "");
    formData.set("notes", values.notes ?? "");

    startTransition(async () => {
      const result = await payTemplateAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.fieldErrors) {
        for (const [name, message] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof PayTemplateInput, { message });
        }
      } else if (result?.success) {
        toast.success("Pago registrado.");
        onOpenChange(false);
      }
    });
  }

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-4 text-gold" />
            Pagar gasto fijo
          </DialogTitle>
          <DialogDescription>
            Se carga como egreso del mes pero <strong>no afecta</strong> el
            efectivo a rendir de ninguna caja.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
          <div className="font-medium">{template.name}</div>
          <div className="text-xs text-muted-foreground">
            {EXPENSE_CATEGORY_LABEL[template.category]}
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto (ARS)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={500}
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || 0)
                        }
                        className="tabular-nums"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expenseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de pago</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Método</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || ""}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
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
                    Registrando…
                  </>
                ) : (
                  "Registrar pago"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
