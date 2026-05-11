"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Plug,
  Power,
  QrCode,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database.types";
import {
  forceDisconnectAction,
  requestWhatsappLogoutAction,
  requestWhatsappReconnectAction,
} from "./actions";

type Status = Database["public"]["Tables"]["whatsapp_status"]["Row"];

function formatJid(jid: string | null): string {
  if (!jid) return "";
  const digits = jid.split("@")[0]?.split(":")[0] ?? "";
  return digits ? `+${digits}` : jid;
}

function StateDot({ state }: { state: string }) {
  const cls =
    state === "connected"
      ? "bg-emerald-500"
      : state === "qr" || state === "connecting" || state === "reconnect_requested"
        ? "bg-amber-500"
        : state === "logout_requested"
          ? "bg-rose-500"
          : "bg-stone-400";
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        cls,
        state !== "connected" && state !== "disconnected" && "animate-pulse",
      )}
    />
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case "connected":
      return "Conectado";
    case "qr":
      return "Esperando escaneo del QR";
    case "connecting":
      return "Conectando…";
    case "reconnect_requested":
      return "Reconectando…";
    case "logout_requested":
      return "Cerrando sesión…";
    default:
      return "Desconectado";
  }
}

export function WhatsappPanel({ initialStatus }: { initialStatus: Status | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status | null>(initialStatus);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    // Helper to refetch status — used by both the realtime subscription and
    // a defensive polling fallback in case realtime drops or the table's
    // replica identity doesn't propagate full row data.
    async function refetch() {
      const { data } = await supabase
        .from("whatsapp_status")
        .select("*")
        .eq("session_id", "default")
        .maybeSingle();
      if (!cancelled && data) setStatus(data as Status);
    }

    const channel = supabase
      .channel("whatsapp-status")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_status",
          filter: "session_id=eq.default",
        },
        (payload) => {
          if (payload.new && Object.keys(payload.new).length > 0) {
            setStatus(payload.new as Status);
          } else {
            // UPDATE without REPLICA IDENTITY FULL → refetch
            void refetch();
          }
        },
      )
      .subscribe();

    // Polling fallback every 2.5s. Cheap (small row) and guarantees the UI
    // stays in sync if realtime hiccups.
    const pollId = setInterval(() => void refetch(), 2500);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  function handleLogout() {
    if (
      !confirm(
        "¿Cerrar la sesión de WhatsApp? Vas a tener que escanear el QR de nuevo para reconectar.",
      )
    )
      return;
    startTransition(async () => {
      const result = await requestWhatsappLogoutAction();
      if (result.error) toast.error(result.error);
      else toast.success("Cerrando sesión…");
    });
  }

  function handleReconnect() {
    startTransition(async () => {
      const result = await requestWhatsappReconnectAction();
      if (result.error) toast.error(result.error);
      else toast.success("Reconectando…");
    });
  }

  function handleForceReset() {
    startTransition(async () => {
      const result = await forceDisconnectAction();
      if (result.error) toast.error(result.error);
      else toast.success("Estado reseteado.");
    });
  }

  const state = status?.state ?? "disconnected";
  const lastConnectedRel = status?.last_connected_at
    ? formatDistanceToNow(new Date(status.last_connected_at), {
        addSuffix: true,
        locale: es,
      })
    : null;

  // Detect a stuck transient state — the worker should move us off these
  // within seconds. If updated_at hasn't moved in a while, the worker is
  // likely offline and we should let the user reset manually.
  const isTransient =
    state === "connecting" ||
    state === "reconnect_requested" ||
    state === "logout_requested";
  const updatedAt = status?.updated_at
    ? new Date(status.updated_at).getTime()
    : 0;
  const stuckMs = Date.now() - updatedAt;
  const looksStuck = isTransient && stuckMs > 12_000;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-full bg-emerald-50 grid place-items-center">
            <Smartphone className="size-5 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">WhatsApp</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StateDot state={state} />
              {stateLabel(state)}
              {state === "connected" && status?.phone_number ? (
                <>
                  {" · "}
                  <span className="font-medium tabular-nums">
                    {formatJid(status.phone_number)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state === "connected" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={isPending}
              className="text-destructive hover:text-destructive"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              Cerrar sesión
            </Button>
          ) : state === "disconnected" ? (
            <Button size="sm" onClick={handleReconnect} disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              Conectar
            </Button>
          ) : (
            // transient state — give an out
            <Button
              variant="ghost"
              size="sm"
              onClick={handleForceReset}
              disabled={isPending}
              title="Resetea el estado a desconectado sin tocar la sesión real."
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {state === "qr" && status?.qr ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border-2 border-dashed border-gold-soft bg-bone p-4">
              <QRCode
                value={status.qr}
                size={240}
                bgColor="transparent"
                fgColor="#1c1917"
              />
            </div>
            <div className="text-center max-w-md">
              <p className="font-medium flex items-center gap-2 justify-center">
                <QrCode className="size-4 text-gold" />
                Escaneá con WhatsApp del salón
              </p>
              <ol className="text-sm text-muted-foreground mt-2 space-y-0.5 text-left max-w-xs mx-auto">
                <li>1. Abrí WhatsApp en el celular.</li>
                <li>2. Tocá ⋮ → <strong>Dispositivos vinculados</strong>.</li>
                <li>3. <strong>Vincular dispositivo</strong> → escaneá este QR.</li>
              </ol>
            </div>
          </div>
        ) : state === "connecting" || state === "reconnect_requested" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="size-10 animate-spin text-gold" />
            <p className="text-sm">
              Conectando con WhatsApp… (puede tardar unos segundos)
            </p>
            {looksStuck ? (
              <div className="mt-2 max-w-sm rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  El worker no respondió en{" "}
                  {Math.round(stuckMs / 1000)}s. Probablemente esté apagado.
                  Verificá que <code>npm run worker</code> esté corriendo, o
                  tocá <strong>Cancelar</strong> arriba para resetear.
                </div>
              </div>
            ) : null}
          </div>
        ) : state === "connected" ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="size-14 rounded-full bg-emerald-50 grid place-items-center">
              <CheckCircle2 className="size-7 text-emerald-700" />
            </div>
            <p className="font-medium">Todo listo</p>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Estás recibiendo mensajes en{" "}
              <a
                href="/crm"
                className="underline hover:text-foreground"
              >
                CRM
              </a>
              . Los mensajes que mandes desde la app se envían en tiempo real.
            </p>
            {lastConnectedRel ? (
              <p className="text-xs text-muted-foreground">
                Conectado {lastConnectedRel}
              </p>
            ) : null}
          </div>
        ) : state === "logout_requested" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="size-10 animate-spin text-rose-500" />
            <p className="text-sm">Cerrando sesión…</p>
          </div>
        ) : (
          // disconnected
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="size-14 rounded-full bg-stone-100 grid place-items-center">
              <Power className="size-7 text-stone-500" />
            </div>
            <p className="font-medium">Sin conexión</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              El worker no está corriendo o se cerró la sesión.
              {status?.last_error ? (
                <>
                  <br />
                  <span className="text-rose-700">{status.last_error}</span>
                </>
              ) : null}
            </p>
            <Button onClick={handleReconnect} disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              Conectar
            </Button>
            {!status?.last_connected_at ? (
              <p className="text-xs text-muted-foreground max-w-sm">
                Si no aparece el QR, verificá que el worker esté corriendo
                (<code className="text-foreground/80">npm run worker</code>).
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer info — when something to show */}
      {state === "qr" || state === "connected" ? (
        <div className="border-t bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
          {state === "qr"
            ? "El QR expira en menos de un minuto. Si no llegás a escanearlo, se genera uno nuevo automáticamente."
            : "El número permanece vinculado mientras el worker esté corriendo en la PC del salón."}
        </div>
      ) : null}
    </div>
  );
}

export function WhatsappPanelSkeleton() {
  return (
    <div className="rounded-xl border bg-card shadow-sm p-5 space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
