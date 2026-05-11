"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addTimeOffAction,
  deleteTimeOffAction,
  getTimeOffAction,
} from "./actions";
import type { ProfessionalRow, TimeOffRow } from "./types";

export function TimeOffDialog({
  open,
  onOpenChange,
  professional,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professional: ProfessionalRow | null;
}) {
  const [rows, setRows] = useState<TimeOffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");

  async function refresh() {
    if (!professional) return;
    setLoading(true);
    const result = await getTimeOffAction(professional.id);
    if ("error" in result && result.error) {
      toast.error(result.error);
    } else {
      setRows(result.entries);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (open && professional) {
      setStartsAt("");
      setEndsAt("");
      setReason("");
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, professional?.id]);

  function handleAdd() {
    if (!professional) return;
    if (!startsAt || !endsAt) {
      toast.error("Cargá la fecha de inicio y fin.");
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      toast.error("El fin tiene que ser posterior al inicio.");
      return;
    }

    const formData = new FormData();
    formData.set("startsAt", new Date(startsAt).toISOString());
    formData.set("endsAt", new Date(endsAt).toISOString());
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await addTimeOffAction(professional.id, formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Día libre cargado.");
        setStartsAt("");
        setEndsAt("");
        setReason("");
        await refresh();
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTimeOffAction(id);
      if (result?.error) {
        toast.error(result.error);
      } else {
        setRows((prev) => prev.filter((r) => r.id !== id));
        toast.success("Eliminado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Días libres / vacaciones — {professional?.full_name ?? ""}
          </DialogTitle>
          <DialogDescription>
            Excepciones puntuales del horario semanal. Bloquea la grilla en ese
            rango y muestra el motivo (vacaciones, feriado, médico, etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Cargar nuevo</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="starts-at">Desde</Label>
              <Input
                id="starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ends-at">Hasta</Label>
              <Input
                id="ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reason">Motivo (opcional)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Vacaciones, feriado…"
              />
            </div>
          </div>
          <Button onClick={handleAdd} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Agregar"
            )}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Cargados</h3>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay días libres cargados.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="text-sm">
                    <div className="font-medium">
                      {format(new Date(r.starts_at), "EEEE d 'de' MMMM, HH:mm", {
                        locale: es,
                      })}
                      {" → "}
                      {format(new Date(r.ends_at), "EEEE d 'de' MMMM, HH:mm", {
                        locale: es,
                      })}
                    </div>
                    {r.reason ? (
                      <div className="text-xs text-muted-foreground">
                        {r.reason}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(r.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="size-4 text-destructive" />
                    <span className="sr-only">Eliminar</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
