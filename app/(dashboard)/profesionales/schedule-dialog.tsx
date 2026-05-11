"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WEEKDAYS } from "@/lib/validations/professionals";
import { getScheduleAction, replaceScheduleAction } from "./actions";
import type { ProfessionalRow } from "./types";

type DayState = {
  weekday: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

const DEFAULT_DAYS: DayState[] = WEEKDAYS.map((w) => ({
  weekday: w.value,
  enabled: false,
  startTime: "09:00",
  endTime: "18:00",
}));

export function ScheduleDialog({
  open,
  onOpenChange,
  professional,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professional: ProfessionalRow | null;
}) {
  const [days, setDays] = useState<DayState[]>(DEFAULT_DAYS);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Load schedule when dialog opens
  useEffect(() => {
    if (!open || !professional) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await getScheduleAction(professional.id);
      if (cancelled) return;
      if ("error" in result && result.error) {
        toast.error(result.error);
        setLoading(false);
        return;
      }
      const map = new Map<
        number,
        { startTime: string; endTime: string }
      >();
      for (const e of result.entries) {
        // Postgres time strings come as "09:00:00" — trim seconds for input[type=time]
        map.set(e.weekday, {
          startTime: e.start_time.slice(0, 5),
          endTime: e.end_time.slice(0, 5),
        });
      }
      setDays(
        WEEKDAYS.map((w) => {
          const existing = map.get(w.value);
          return {
            weekday: w.value,
            enabled: !!existing,
            startTime: existing?.startTime ?? "09:00",
            endTime: existing?.endTime ?? "18:00",
          };
        }),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, professional?.id]);

  function setDay(weekday: number, patch: Partial<DayState>) {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  }

  function applyToAll(template: DayState) {
    setDays((prev) =>
      prev.map((d) => ({
        ...d,
        enabled: d.enabled || template.enabled,
        startTime: template.startTime,
        endTime: template.endTime,
      })),
    );
  }

  function onSave() {
    if (!professional) return;
    // Validation: every enabled day must have end > start
    const invalid = days.find(
      (d) => d.enabled && d.endTime <= d.startTime,
    );
    if (invalid) {
      toast.error(
        `El horario del ${WEEKDAYS.find((w) => w.value === invalid.weekday)?.long} es inválido (fin debe ser posterior al inicio).`,
      );
      return;
    }

    const entries = days
      .filter((d) => d.enabled)
      .map((d) => ({
        weekday: d.weekday,
        startTime: d.startTime,
        endTime: d.endTime,
      }));

    const formData = new FormData();
    formData.set("entries", JSON.stringify(entries));

    startTransition(async () => {
      const result = await replaceScheduleAction(professional.id, formData);
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.success) {
        toast.success("Horario actualizado.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Horario semanal — {professional?.full_name ?? ""}
          </DialogTitle>
          <DialogDescription>
            Tildá los días que trabaja y definí el horario. Los días no tildados
            quedan sin disponibilidad. Esto es la base; los días libres
            puntuales (vacaciones, feriados) se cargan aparte.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {days.map((d) => {
                const meta = WEEKDAYS.find((w) => w.value === d.weekday)!;
                return (
                  <div
                    key={d.weekday}
                    className="grid grid-cols-[110px_1fr_1fr_auto] items-center gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`day-${d.weekday}`}
                        checked={d.enabled}
                        onCheckedChange={(c) =>
                          setDay(d.weekday, { enabled: c === true })
                        }
                      />
                      <Label
                        htmlFor={`day-${d.weekday}`}
                        className="font-normal"
                      >
                        {meta.long}
                      </Label>
                    </div>
                    <Input
                      type="time"
                      step={900}
                      disabled={!d.enabled}
                      value={d.startTime}
                      onChange={(e) =>
                        setDay(d.weekday, { startTime: e.target.value })
                      }
                    />
                    <Input
                      type="time"
                      step={900}
                      disabled={!d.enabled}
                      value={d.endTime}
                      onChange={(e) =>
                        setDay(d.weekday, { endTime: e.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!d.enabled}
                      onClick={() => applyToAll(d)}
                      title="Copiar este horario al resto"
                    >
                      Copiar
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isPending || loading}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar horario"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
