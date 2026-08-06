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
  professionalSchema,
  type ProfessionalInput,
} from "@/lib/validations/professionals";
import {
  createProfessionalAction,
  updateProfessionalAction,
} from "./actions";
import type { ProfessionalRow } from "./types";

type ProfessionalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professional: ProfessionalRow | null;
};

export function ProfessionalDialog({
  open,
  onOpenChange,
  professional,
}: ProfessionalDialogProps) {
  const [isPending, startTransition] = useTransition();
  const editing = professional !== null;

  const form = useForm<ProfessionalInput>({
    resolver: zodResolver(professionalSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      color: "#c49c76",
      commissionRate: 50,
      commissionRateNet: 0,
      active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        fullName: professional?.full_name ?? "",
        phone: professional?.phone ?? "",
        color: professional?.color ?? "#c49c76",
        commissionRate: professional ? Number(professional.commission_rate) : 50,
        commissionRateNet: professional
          ? Number(professional.commission_rate_net)
          : 0,
        active: professional?.active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, professional?.id]);

  function onSubmit(values: ProfessionalInput) {
    const formData = new FormData();
    formData.set("fullName", values.fullName);
    formData.set("phone", values.phone ?? "");
    formData.set("color", values.color);
    formData.set("commissionRate", String(values.commissionRate));
    formData.set("commissionRateNet", String(values.commissionRateNet));
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updateProfessionalAction(professional.id, formData)
        : await createProfessionalAction(formData);

      if (result?.error) {
        toast.error(result.error);
      } else if (result?.fieldErrors) {
        for (const [name, message] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof ProfessionalInput, { message });
        }
      } else if (result?.success) {
        toast.success(
          editing ? "Profesional actualizada." : "Profesional creada.",
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
            {editing ? "Editar profesional" : "Nueva profesional"}
          </DialogTitle>
          <DialogDescription>
            Cargá los datos básicos. Después podés definir su horario semanal y
            días libres con los botones de la fila.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo</FormLabel>
                  <FormControl>
                    <Input placeholder="Sofía García" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="+54 9 351 ..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color en grilla</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        type="color"
                        className="h-9 w-14 p-1"
                        {...field}
                      />
                      <Input
                        type="text"
                        value={field.value}
                        onChange={field.onChange}
                        maxLength={7}
                        className="font-mono"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md border bg-muted/20 p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Comisiones</p>
                <p className="text-xs text-muted-foreground">
                  Bruto = % por cada servicio que cobra. Neto = % sobre la
                  ganancia del salón (ingresos − egresos del mes).
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="commissionRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bruto (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          {...field}
                          onChange={(e) =>
                            field.onChange(e.target.valueAsNumber || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Por servicio facturado
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="commissionRateNet"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Neto (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          {...field}
                          onChange={(e) =>
                            field.onChange(e.target.valueAsNumber || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Del neto mensual del salón
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
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
                      Solo aparece en la grilla y en los selectores cuando está
                      activa.
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
                  "Crear profesional"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewProfessionalButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Nueva profesional</Button>
      <ProfessionalDialog
        open={open}
        onOpenChange={setOpen}
        professional={null}
      />
    </>
  );
}
