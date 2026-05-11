"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  quickReplySchema,
  type QuickReplyInput,
} from "@/lib/validations/crm-config";
import {
  createQuickReplyAction,
  deleteQuickReplyAction,
  updateQuickReplyAction,
} from "./config-actions";
import type { QuickReply } from "./config-types";

export function QuickRepliesManager({ replies }: { replies: QuickReply[] }) {
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(qr: QuickReply) {
    setEditing(qr);
    setOpen(true);
  }

  function handleDelete(qr: QuickReply) {
    if (!confirm(`¿Archivar "${qr.label}"?`)) return;
    startTransition(async () => {
      const result = await deleteQuickReplyAction(qr.id);
      if (result.error) toast.error(result.error);
      else toast.success("Mensaje archivado.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Plantillas de texto para insertar rápido en el chat con un click.
          Podés ponerle un atajo tipo <code>/saludo</code> para encontrarlas
          más rápido.
        </p>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Nuevo mensaje
        </Button>
      </div>

      {replies.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          Todavía no hay mensajes rápidos.
        </div>
      ) : (
        <div className="space-y-2">
          {replies.map((qr) => (
            <div
              key={qr.id}
              className={
                "rounded-md border bg-card p-3 flex items-start gap-3 " +
                (qr.active ? "" : "opacity-60")
              }
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{qr.label}</span>
                  {qr.shortcut ? (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {qr.shortcut}
                    </Badge>
                  ) : null}
                  {!qr.active ? (
                    <Badge variant="outline" className="text-[10px]">
                      Archivado
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {qr.body}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openEdit(qr)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                {qr.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => handleDelete(qr)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <QuickReplyDialog open={open} onOpenChange={setOpen} reply={editing} />
    </div>
  );
}

function QuickReplyDialog({
  open,
  onOpenChange,
  reply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reply: QuickReply | null;
}) {
  const editing = reply !== null;
  const [isPending, startTransition] = useTransition();

  const form = useForm<QuickReplyInput>({
    resolver: zodResolver(quickReplySchema),
    defaultValues: {
      label: "",
      body: "",
      shortcut: "",
      active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        label: reply?.label ?? "",
        body: reply?.body ?? "",
        shortcut: reply?.shortcut ?? "",
        active: reply?.active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reply?.id]);

  function onSubmit(values: QuickReplyInput) {
    const formData = new FormData();
    formData.set("label", values.label);
    formData.set("body", values.body);
    formData.set("shortcut", values.shortcut ?? "");
    formData.set("active", String(values.active));

    startTransition(async () => {
      const result = editing
        ? await updateQuickReplyAction(reply.id, formData)
        : await createQuickReplyAction(formData);
      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) {
        for (const [name, msg] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof QuickReplyInput, { message: msg });
        }
      } else if (result.success) {
        toast.success(editing ? "Mensaje actualizado." : "Mensaje creado.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar mensaje rápido" : "Nuevo mensaje rápido"}
          </DialogTitle>
          <DialogDescription>
            Texto que vas a poder insertar en el chat con un click.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Saludo inicial" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shortcut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Atajo (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="/saludo" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mensaje</FormLabel>
                  <FormControl>
                    <Textarea rows={5} placeholder="Hola! En qué te puedo ayudar?" {...field} />
                  </FormControl>
                  <FormDescription>
                    El texto que se va a pegar en el input del chat. Podés
                    editarlo antes de enviar.
                  </FormDescription>
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
                    <FormLabel>Activo</FormLabel>
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
                {editing ? "Guardar cambios" : "Crear mensaje"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
