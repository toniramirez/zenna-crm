"use client";

import { Loader2, Save, Signpost } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { renderTemplate } from "@/lib/validations/crm-config";
import type { Database } from "@/types/database.types";
import { updateLegacyRedirectAction } from "./actions";

export type LegacySettings =
  Database["public"]["Tables"]["whatsapp_legacy_settings"]["Row"];

/**
 * La respuesta automática del número viejo.
 *
 * Vive dentro del panel de Baileys porque es lo único que ese número hace por
 * su cuenta desde la migración: recibir, guardar en el archivo, y mandar a la
 * gente al número nuevo. Todo lo demás —automatizaciones, turnero, encuestas—
 * pasó a salir por la WhatsApp API.
 */
export function LegacyRedirectPanel({
  settings,
}: {
  settings: LegacySettings | null;
}) {
  const [enabled, setEnabled] = useState(settings?.redirect_enabled ?? false);
  const [message, setMessage] = useState(settings?.redirect_message ?? "");
  const [number, setNumber] = useState(settings?.redirect_number ?? "");
  const [cooldown, setCooldown] = useState(
    settings?.redirect_cooldown_minutes ?? 0,
  );
  const [isPending, startTransition] = useTransition();

  // La vista previa usa el mismo reemplazo que el worker: lo que se lee acá es
  // literalmente lo que va a recibir quien escriba al número viejo.
  const preview = renderTemplate(message, {
    numero: number.trim() || "(falta el número nuevo)",
  });

  function handleSave() {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("message", message);
    formData.set("number", number);
    formData.set("cooldownMinutes", String(cooldown));

    startTransition(async () => {
      const result = await updateLegacyRedirectAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success("Redirección guardada.");
    });
  }

  if (!settings) {
    return (
      <div className="border-t bg-muted/10 px-5 py-4 text-xs text-muted-foreground">
        Para configurar la redirección al número nuevo, corré{" "}
        <code className="text-foreground/80">
          scripts/sql/whatsapp-migration.sql
        </code>{" "}
        en Supabase.
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t bg-muted/10 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Signpost className="mt-0.5 size-4 shrink-0 text-gold" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Redirección al número nuevo</h3>
            <p className="text-xs text-muted-foreground">
              Contesta solo a quien escriba a este número y lo manda al de la
              WhatsApp API.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Activar la redirección automática"
        />
      </div>

      {enabled ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="redirect-number">Número nuevo</Label>
              <Input
                id="redirect-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+54 9 351 123-4567"
              />
              <p className="text-[11px] text-muted-foreground">
                Es lo que reemplaza a <code>{`{{numero}}`}</code>. Escribilo
                como querés que se lea.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="redirect-cooldown">Repetir cada</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="redirect-cooldown"
                  type="number"
                  min={0}
                  step={1}
                  value={cooldown}
                  onChange={(e) =>
                    setCooldown(Math.max(0, e.target.valueAsNumber || 0))
                  }
                  className="tabular-nums"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {cooldown === 0
                  ? "Contesta cada vez que escriban."
                  : "Como mucho un aviso por chat en ese lapso."}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="redirect-message">Mensaje</Label>
            <Textarea
              id="redirect-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="¡Hola! 👋 Este número ya no está en uso. Escribinos al {{numero}}."
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Así lo recibe la clienta
            </Label>
            <div className="rounded-md bg-background px-3 py-2 text-xs whitespace-pre-wrap">
              {preview || "—"}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Apagada: los mensajes al número viejo se guardan en su bandeja pero
          nadie recibe respuesta automática.
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Guardar
        </Button>
      </div>
    </div>
  );
}
