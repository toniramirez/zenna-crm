"use client";

import { formatDistanceToNow, isPast, subDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  LogOut,
  Plug,
  RefreshCw,
} from "lucide-react";
import { InstagramIcon } from "@/components/icons/instagram";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { InstagramAccountPublic } from "@/lib/instagram/config";
import {
  connectInstagramAction,
  disconnectInstagramAction,
  testInstagramAction,
  type ActionState,
} from "./instagram-actions";

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

export function InstagramPanel({
  account,
  webhookUrl,
  verifyTokenConfigured,
  appSecretConfigured,
  serviceKeyConfigured,
}: {
  account: InstagramAccountPublic | null;
  webhookUrl: string;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  serviceKeyConfigured: boolean;
}) {
  const [formState, formAction, isSubmitting] = useActionState<
    ActionState,
    FormData
  >(connectInstagramAction, {});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (formState.error) toast.error(formState.error);
    if (formState.success) toast.success("Cuenta de Instagram conectada.");
  }, [formState]);

  const state = account?.state ?? "disconnected";
  const connected = state === "connected" && account?.has_token;

  const expiresRel = account?.token_expires_at
    ? formatDistanceToNow(new Date(account.token_expires_at), {
        addSuffix: true,
        locale: es,
      })
    : null;
  // `isPast(vencimiento - 10 días)` = "le quedan menos de 10 días" (o ya venció).
  // Se lee el reloj vía date-fns, igual que `formatDistanceToNow` acá arriba,
  // en vez de llamar a `Date.now()` durante el render.
  const expiresSoon = account?.token_expires_at
    ? isPast(subDays(new Date(account.token_expires_at), 10))
    : false;

  function handleDisconnect() {
    if (!confirm("¿Desconectar Instagram? Los DMs dejan de entrar al CRM."))
      return;
    startTransition(async () => {
      const result = await disconnectInstagramAction();
      if (result.error) toast.error(result.error);
      else toast.success("Instagram desconectado.");
    });
  }

  function handleTest() {
    startTransition(async () => {
      const result = await testInstagramAction();
      if (result.error) toast.error(result.error);
      else toast.success(`Conexión OK${result.username ? ` — @${result.username}` : ""}`);
    });
  }

  const missingEnv = [
    !serviceKeyConfigured && "SUPABASE_SERVICE_ROLE_KEY",
    !appSecretConfigured && "INSTAGRAM_APP_SECRET",
    !verifyTokenConfigured && "INSTAGRAM_VERIFY_TOKEN",
  ].filter((v): v is string => typeof v === "string");

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-fuchsia-50">
            <InstagramIcon className="size-5 text-fuchsia-700" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">Instagram</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StateDot state={state} />
              {stateLabel(state)}
              {connected && account?.username ? (
                <>
                  {" · "}
                  <span className="font-medium">@{account.username}</span>
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
                title="Revalida el token contra Meta."
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
                <p>Sin eso el webhook rechaza todo lo que manda Meta.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Datos para pegar en el App Dashboard de Meta */}
        <div className="space-y-3">
          <p className="text-sm font-medium">1. Configurá el webhook en Meta</p>
          <CopyField label="Callback URL" value={webhookUrl} />
          <p className="text-xs text-muted-foreground">
            En el App Dashboard de Meta → Webhooks → Instagram, pegá esta URL, usá
            el <code>INSTAGRAM_VERIFY_TOKEN</code> como Verify Token y suscribite
            al campo <strong>messages</strong>.
          </p>
        </div>

        {/* Conexión de la cuenta */}
        <div className="space-y-3 border-t pt-5">
          <p className="text-sm font-medium">
            2. {connected ? "Cuenta conectada" : "Conectá la cuenta"}
          </p>

          {connected ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="size-4" />
                Los DMs de @{account?.username} entran a la bandeja del CRM.
              </div>
              {expiresRel ? (
                <p
                  className={cn(
                    "text-xs",
                    expiresSoon ? "text-amber-700" : "text-muted-foreground",
                  )}
                >
                  El token vence {expiresRel}. Se renueva solo mientras el worker
                  de Instagram esté corriendo.
                </p>
              ) : null}
            </div>
          ) : (
            <form action={formAction} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="access_token" className="text-xs">
                  Token de acceso de Instagram
                </Label>
                <Input
                  id="access_token"
                  name="access_token"
                  type="password"
                  autoComplete="off"
                  placeholder="IGAAQ..."
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Se valida contra Meta antes de guardarlo. Queda en una tabla
                  que solo el servidor puede leer: nunca vuelve al navegador.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login_type" className="text-xs">
                  Tipo de conexión
                </Label>
                <select
                  id="login_type"
                  name="login_type"
                  defaultValue="instagram"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="instagram">
                    Instagram Login (recomendado)
                  </option>
                  <option value="facebook">
                    Facebook Login (cuenta vinculada a una Página)
                  </option>
                </select>
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
      </div>
    </div>
  );
}
