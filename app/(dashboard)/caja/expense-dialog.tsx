"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  EXPENSE_CATEGORIES,
  expenseSchema,
  type ExpenseInput,
} from "@/lib/validations/expenses";
import { PAYMENT_METHODS } from "@/lib/validations/payments";
import { createExpenseAction } from "./actions";

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function NewExpenseButton({
  defaultDate,
  variant = "default",
}: {
  defaultDate?: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initialDate = defaultDate ?? todayIsoDate();

  const form = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: "insumos",
      description: "",
      amount: 0,
      expenseDate: initialDate,
      paymentMethod: "cash",
      cashSourceDate: initialDate,
      notes: "",
    },
  });

  // Watch payment method to conditionally show cash source field
  const paymentMethod = useWatch({
    control: form.control,
    name: "paymentMethod",
  });
  const expenseDate = useWatch({ control: form.control, name: "expenseDate" });

  // Default cashSourceDate to expenseDate when method becomes cash for the
  // first time, or when expenseDate changes and the source matches the previous
  // date (i.e., user hadn't manually picked a different caja).
  useEffect(() => {
    if (paymentMethod === "cash") {
      const current = form.getValues("cashSourceDate");
      if (!current) {
        form.setValue("cashSourceDate", expenseDate);
      }
    }
  }, [paymentMethod, expenseDate, form]);

  function onSubmit(values: ExpenseInput) {
    const formData = new FormData();
    formData.set("category", values.category);
    formData.set("description", values.description ?? "");
    formData.set("amount", String(values.amount));
    formData.set("expenseDate", values.expenseDate);
    formData.set("paymentMethod", values.paymentMethod ?? "");
    formData.set("cashSourceDate", values.cashSourceDate ?? "");
    formData.set("notes", values.notes ?? "");

    startTransition(async () => {
      const result = await createExpenseAction(formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.fieldErrors) {
        for (const [name, message] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof ExpenseInput, { message });
        }
      } else if (result?.success) {
        toast.success("Egreso registrado.");
        form.reset({
          category: "insumos",
          description: "",
          amount: 0,
          expenseDate: initialDate,
          paymentMethod: "cash",
          cashSourceDate: initialDate,
          notes: "",
        });
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>Registrar egreso</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo egreso</DialogTitle>
          <DialogDescription>
            Insumos, alquiler, sueldos, marketing… lo que sale de caja.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: tintura rubio claro" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Importe (ARS)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || 0)
                        }
                        className="tabular-nums"
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
                    <FormLabel>Fecha del egreso</FormLabel>
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

            {paymentMethod === "cash" ? (
              <FormField
                control={form.control}
                name="cashSourceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale del efectivo de la caja del día</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormDescription>
                      Por defecto coincide con la fecha del egreso. Cambialo si
                      la plata salió de la caja de otro día.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

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
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  "Guardar egreso"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
