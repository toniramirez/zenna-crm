"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  LogOut,
  Plug,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WhatsappCloudAccountPublic } from "@/lib/whatsapp-cloud/config";
import {
  connectWhatsappCloudAction,
  disconnectWhatsappCloudAction,
  syncWhatsappTemplatesAction,
  testWhatsappCloudAction,
  type ActionState,
} from "./whatsapp-cloud-actions";

/** Lo que el panel necesita mostrar de cada plantilla cacheada. */
export type TemplateSlim = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
};

function StateDot({ state }: { state: string }) {
  const cls =
    state === "connected"
      ? "bg-emerald-500"
      : state === "error"
        ? "bg-rose-500"
        : "bg-stone-400";
  return <span className={cn("inline-block size-2 rounded-full", cls)} />;
}

function stateLabel(state: string): string {
  switch (state) {
    case "connected":
      return "Conectado";
    case "error":
      return "Con problemas";
    default:
      return "Desconectado";
  }
}

/** Campo de solo lectura pensado para copiar y pegar en el panel de Meta. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No pudimos copiar. Seleccionalo a mano.");
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-xs">
          {value}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function templateStatusBadge(status: string) {
  const s = status.toUpperCase();
  const cls =
    s === "APPROVED"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : s === "REJECTED" || s === "DISABLED"
        ? "border-rose-300 bg-rose-50 text-rose-800"
        : "border-amber-300 bg-amber-50 text-amber-800";
  const label =
    s === "APPROVED"
      ? "Aprobada"
      : s === "REJECTED"
        ? "Rechazada"
        : s === "PAUSED"
          ? "Pausada"
          : s === "DISABLED"
            ? "Deshabilitada"
            : "Pendiente";
  return (
    <Badge variant="outline" className={cn("text-[10px]", cls)}>
      {label}
    </Badge>
  );
}

export function WhatsappCloudPanel({
  account,
  templates,
  webhookUrl,
  verifyTokenConfigured,
  appSecretConfigured,
  serviceKeyConfigured,
}: {
  account: WhatsappCloudAccountPublic | null;
  templates: TemplateSlim[];
  webhookUrl: string;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  serviceKeyConfigured: boolean;
}) {
  const [formState, formAction, isSubmitting] = useActionState<
    ActionState,
    FormData
  >(connectWhatsappCloudAction, {});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (formState.error) toast.error(formState.error);
    if (formState.success) toast.success("Número de WhatsApp API conectado.");
  }, [formState]);

  const state = account?.state ?? "disconnected";
  const connected = state === "connected" && account?.has_token;

  const approved = templates.filter(
    (t) => t.status.toUpperCase() === "APPROVED",
  );

  const syncedRel = account?.templates_synced_at
    ? formatDistanceToNow(new Date(account.templates_synced_at), {
        addSuffix: true,
        locale: es,
      })
    : null;

  function handleDisconnect() {
    if (
      !confirm(
        "¿Desconectar WhatsApp API? Los mensajes de este número dejan de salir (los entrantes siguen llegando por el webhook).",
      )
    )
      return;
    startTransition(async () => {
      const result = await disconnectWhatsappCloudAction();
      if (result.error) toast.error(result.error);
      else toast.success("WhatsApp API desconectado.");
    });
  }

  function handleTest() {
    startTransition(async () => {
      const result = await testWhatsappCloudAction();
      if (result.error) toast.error(result.error);
      else
        toast.success(
          `Conexión OK${result.phone ? ` — ${result.phone}` : ""}`,
        );
    });
  }

  function handleSyncTemplates() {
    startTransition(async () => {
      const result = await syncWhatsappTemplatesAction();
      if (result.error) toast.error(result.error);
      else
        toast.success(
          `Plantillas sincronizadas: ${result.approved ?? 0} aprobada(s) de ${result.total ?? 0}.`,
        );
    });
  }

  const missingEnv = [
    !serviceKeyConfigured && "SUPABASE_SERVICE_ROLE_KEY",
    !appSecretConfigured && "WHATSAPP_APP_SECRET",
    !verifyTokenConfigured && "WHATSAPP_VERIFY_TOKEN",
  ].filter((v): v is string => typeof v === "string");

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-emerald-50">
            <Zap className="size-5 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">WhatsApp API</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StateDot state={state} />
              {stateLabel(state)}
              {connected && account?.display_phone_number ? (
                <>
                  {" · "}
                  <span className="font-medium">
                    {account.display_phone_number}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTest}
                disabled={isPending}
                title="Revalida las credenciales contra Meta."
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Probar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isPending}
                className="text-destructive hover:text-destructive"
              >
                <LogOut className="size-4" />
                Desconectar
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="space-y-5 p-5">
        <p className="text-xs text-muted-foreground">
          Canal oficial de Meta (Cloud API). Convive con el WhatsApp del QR: es
          otro número, con su propio chat en la misma bandeja, y es el único de
          los dos que puede mandar <strong>plantillas</strong> fuera de la
          ventana de 24 h.
        </p>

        {account?.last_error ? (
          <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>{account.last_error}</div>
          </div>
        ) : null}

        {missingEnv.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p>
                Falta configurar{" "}
                {missingEnv.map((name, i) => (
                  <span key={name}>
                    {i > 0 ? (i === missingEnv.length - 1 ? " y " : ", ") : null}
                    <code>{name}</code>
                  </span>
                ))}{" "}
                en las variables de entorno.
              </p>
              {!serviceKeyConfigured ? (
                <p>
                  Sin la service key no se puede leer ni guardar la cuenta
                  conectada.
                </p>
              ) : null}
              {!appSecretConfigured || !verifyTokenConfigured ? (
                <p>
                  Sin eso el webhook rechaza todo lo que manda Meta. Si WhatsApp
                  está en la misma app de Meta que Instagram, sirven las
                  variables <code>INSTAGRAM_*</code> ya cargadas.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Datos para pegar en el App Dashboard de Meta */}
        <div className="space-y-3">
          <p className="text-sm font-medium">1. Configurá el webhook en Meta</p>
          <CopyField label="Callback URL" value={webhookUrl} />
          <p className="text-xs text-muted-foreground">
            En el App Dashboard de Meta → WhatsApp → Configuration → Webhooks,
            pegá esta URL, usá el <code>WHATSAPP_VERIFY_TOKEN</code> como Verify
            Token y suscribite a los campos <strong>messages</strong> y{" "}
            <strong>message_template_status_update</strong>.
          </p>
        </div>

        {/* Conexión de la cuenta */}
        <div className="space-y-3 border-t pt-5">
          <p className="text-sm font-medium">
            2. {connected ? "Número conectado" : "Conectá el número"}
          </p>

          {connected ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="size-4" />
                {account?.verified_name
                  ? `${account.verified_name} · ${account?.display_phone_number ?? ""}`
                  : account?.display_phone_number}{" "}
                listo para enviar por la API.
              </div>
              {account?.quality_rating ? (
                <p className="text-xs text-muted-foreground">
                  Calidad del número según Meta:{" "}
                  <span className="font-medium">{account.quality_rating}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <form action={formAction} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wa_access_token" className="text-xs">
                  Token de acceso
                </Label>
                <Input
                  id="wa_access_token"
                  name="access_token"
                  type="password"
                  autoComplete="off"
                  placeholder="EAAG..."
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Ideal: el token permanente de un System User de Meta Business
                  (no vence). Se valida contra Meta antes de guardarlo y queda en
                  una tabla que solo el servidor puede leer.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wa_phone_number_id" className="text-xs">
                  Phone Number ID
                </Label>
                <Input
                  id="wa_phone_number_id"
                  name="phone_number_id"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="123456789012345"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wa_waba_id" className="text-xs">
                  WhatsApp Business Account ID
                </Label>
                <Input
                  id="wa_waba_id"
                  name="waba_id"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="123456789012345"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Los dos IDs están en el App Dashboard → WhatsApp → API Setup.
                </p>
              </div>

              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Conectar
              </Button>
            </form>
          )}
        </div>

        {/* Plantillas */}
        {connected ? (
          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">3. Plantillas</p>
                <p className="text-xs text-muted-foreground">
                  {approved.length} aprobada(s) de {templates.length}
                  {syncedRel ? ` · sincronizadas ${syncedRel}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncTemplates}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Sincronizar
              </Button>
            </div>

            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay plantillas todavía. Se crean en el WhatsApp Manager de
                Meta y acá aparecen al sincronizar (o solas, cuando Meta avisa
                que se aprobaron).
              </p>
            ) : (
              <ul className="space-y-1.5">
                {templates.slice(0, 8).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {t.name}
                    </span>
                    <span className="text-muted-foreground">{t.language}</span>
                    {templateStatusBadge(t.status)}
                  </li>
                ))}
                {templates.length > 8 ? (
                  <li className="px-3 text-xs text-muted-foreground">
                    …y {templates.length - 8} más.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
