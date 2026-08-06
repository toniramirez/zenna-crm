"use client";

import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
  clientTagSchema,
  type ClientTagInput,
} from "@/lib/validations/crm-config";
import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
} from "./config-actions";
import type { ClientTag } from "./config-types";

/**
 * Swatches de la paleta de marca (rampas de app/globals.css). Antes eran los
 * colores de fábrica de Tailwind, que al lado del sistema cálido se veían
 * fluorescentes.
 */
const DEFAULT_COLORS = [
  "#ed403f", // red-500
  "#f0aa63", // amber-400
  "#00bb7f", // emerald-500
  "#00a5ef", // sky-500
  "#8d54ff", // violet-500
  "#c49c76", // champagne-500
  "#986253", // mocha-400
  "#a19d9c", // stone-400
];

export function TagsManager({ tags }: { tags: ClientTag[] }) {
  const [editing, setEditing] = useState<ClientTag | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(tag: ClientTag) {
    setEditing(tag);
    setOpen(true);
  }

  function handleDelete(tag: ClientTag) {
    if (!confirm(`¿Archivar la etiqueta "${tag.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteTagAction(tag.id);
      if (result.error) toast.error(result.error);
      else toast.success("Etiqueta archivada.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Etiquetas reutilizables que podés asignar a clientas (VIP, novia,
          color, etc.).
        </p>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Nueva etiqueta
        </Button>
      </div>

      {tags.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          Todavía no hay etiquetas creadas.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <TagPill
              key={tag.id}
              tag={tag}
              onEdit={() => openEdit(tag)}
              onDelete={() => handleDelete(tag)}
            />
          ))}
        </div>
      )}

      <TagDialog open={open} onOpenChange={setOpen} tag={editing} />
    </div>
  );
}

function TagPill({
  tag,
  onEdit,
  onDelete,
}: {
  tag: ClientTag;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={"group inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-1 transition-shadow hover:shadow-sm " + (tag.active ? "" : "opacity-60")}
      style={{ borderColor: tag.color }}
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="text-sm font-medium">{tag.name}</span>
      {!tag.active ? (
        <Badge variant="outline" className="ml-0.5 text-[10px] py-0">
          Archivada
        </Badge>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onEdit}
        title="Editar"
      >
        <Pencil className="size-3" />
      </Button>
      {tag.active ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onDelete}
          title="Archivar"
        >
          <Trash2 className="size-3 text-destructive" />
        </Button>
      ) : null}
    </div>
  );
}

function TagDialog({
  open,
  onOpenChange,
  tag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: ClientTag | null;
}) {
  const editing = tag !== null;
  const [isPending, startTransition] = useTransition();

  const form = useForm<ClientTagInput>({
    resolver: zodResolver(clientTagSchema),
    defaultValues: {
      name: "",
      color: DEFAULT_COLORS[0]!,
      active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: tag?.name ?? "",
        color: tag?.color ?? DEFAULT_COLORS[0]!,
        active: tag?.active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tag?.id]);

  function onSubmit(values: ClientTagInput) {
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("color", values.color);
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updateTagAction(tag.id, formData)
        : await createTagAction(formData);
      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) {
        for (const [name, msg] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof ClientTagInput, { message: msg });
        }
      } else if (result.success) {
        toast.success(editing ? "Etiqueta actualizada." : "Etiqueta creada.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar etiqueta" : "Nueva etiqueta"}
          </DialogTitle>
          <DialogDescription>
            Las etiquetas las usás para clasificar clientas (ej: VIP, novia,
            color permanente).
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
                    <Input placeholder="VIP" {...field} />
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
                  <FormLabel>Color</FormLabel>
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
                      className="font-mono flex-1"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {DEFAULT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => field.onChange(c)}
                        className="size-7 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: field.value === c ? "#000" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                    <FormLabel>Activa</FormLabel>
                    <FormDescription>
                      Solo aparece en el selector si está activa.
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
                ) : (
                  <Power className="size-4" />
                )}
                {editing ? "Guardar cambios" : "Crear etiqueta"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
