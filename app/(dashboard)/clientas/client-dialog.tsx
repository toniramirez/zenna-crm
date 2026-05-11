"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  clientSchema,
  parseTagsString,
  tagsToString,
  type ClientInput,
} from "@/lib/validations/clients";
import { createClientAction, updateClientAction } from "./actions";
import type { ClientRow } from "./types";

type ClientDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRow | null;
};

export function ClientDialog({
  open,
  onOpenChange,
  client,
}: ClientDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [tagsRaw, setTagsRaw] = useState("");
  const editing = client !== null;

  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      instagramHandle: "",
      birthday: "",
      hairNotes: "",
      notes: "",
      tags: [],
    },
  });

  useEffect(() => {
    if (open) {
      const initialTags = client?.tags ?? [];
      setTagsRaw(tagsToString(initialTags));
      form.reset({
        fullName: client?.full_name ?? "",
        phone: client?.phone ?? "",
        email: client?.email ?? "",
        instagramHandle: client?.instagram_handle ?? "",
        birthday: client?.birthday ?? "",
        hairNotes: client?.hair_notes ?? "",
        notes: client?.notes ?? "",
        tags: initialTags,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  function onSubmit(values: ClientInput) {
    const formData = new FormData();
    formData.set("fullName", values.fullName);
    formData.set("phone", values.phone ?? "");
    formData.set("email", values.email ?? "");
    formData.set("instagramHandle", values.instagramHandle ?? "");
    formData.set("birthday", values.birthday ?? "");
    formData.set("hairNotes", values.hairNotes ?? "");
    formData.set("notes", values.notes ?? "");
    formData.set("tags", tagsRaw);

    startTransition(async () => {
      const result = editing
        ? await updateClientAction(client.id, formData)
        : await createClientAction(formData);

      if (result?.error) {
        toast.error(result.error);
      } else if (result?.fieldErrors) {
        for (const [name, message] of Object.entries(result.fieldErrors)) {
          form.setError(name as keyof ClientInput, { message });
        }
      } else if (result?.success) {
        toast.success(editing ? "Clienta actualizada." : "Clienta creada.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar clienta" : "Nueva clienta"}
          </DialogTitle>
          <DialogDescription>
            Cargá datos de contacto, ficha capilar y etiquetas.
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
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="instagramHandle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram</FormLabel>
                    <FormControl>
                      <Input placeholder="@usuario" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthday"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cumpleaños</FormLabel>
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
              name="hairNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ficha capilar</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Tipo de pelo, color base, fórmulas usadas, alergias…"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Lo que necesitás recordar antes de cada visita.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas generales</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Comportamiento, preferencias, observaciones…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <FormLabel>Etiquetas</FormLabel>
              <Input
                placeholder="vip, color, novia"
                value={tagsRaw}
                onChange={(e) => {
                  setTagsRaw(e.target.value);
                  form.setValue("tags", parseTagsString(e.target.value));
                }}
              />
              <FormDescription>
                Separadas por coma. Ej: <em>vip, color, novia, mechas</em>.
              </FormDescription>
            </div>
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
                  "Crear clienta"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Nueva clienta</Button>
      <ClientDialog open={open} onOpenChange={setOpen} client={null} />
    </>
  );
}
