"use client";

import {
  Bell,
  BellOff,
  BellRing,
  Loader2,
  Share,
  SmartphoneNfc,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Activación de notificaciones push para la PWA.
 *
 * En iPhone hay tres condiciones que se tienen que cumplir sí o sí, y por eso
 * el panel explica cada una en vez de mostrar un botón que "no hace nada":
 *   1. iOS 16.4 o más nuevo;
 *   2. la app agregada a la pantalla de inicio (Compartir → Agregar a inicio);
 *   3. el permiso otorgado desde dentro de esa app instalada, no desde Safari.
 */

/**
 * La clave VAPID viaja en base64url y `subscribe()` la quiere en bytes.
 * El `ArrayBuffer` explícito es para el tipo: `Uint8Array` genérico admite
 * `SharedArrayBuffer`, que `applicationServerKey` no acepta.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Support = "checking" | "ok" | "unsupported";

/**
 * Todo lo que hay que mirar del dispositivo va en un solo estado: se resuelve
 * de una y evita cuatro `setState` seguidos en el arranque.
 */
type Env = {
  support: Support;
  isIOS: boolean;
  standalone: boolean;
  permission: NotificationPermission;
};

const INITIAL_ENV: Env = {
  support: "checking",
  isIOS: false,
  standalone: false,
  permission: "default",
};

export function NotificationsPanel({
  vapidPublicKey,
}: {
  vapidPublicKey: string | null;
}) {
  const [{ support, isIOS, standalone, permission }, setEnv] =
    useState<Env>(INITIAL_ENV);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const setPermission = useCallback((permission: NotificationPermission) => {
    setEnv((prev) => ({ ...prev, permission }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        // iPadOS se presenta como Mac; el touch lo delata.
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // Safari en iOS usa esta propiedad propietaria en vez del media query.
        (window.navigator as { standalone?: boolean }).standalone === true;

      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) {
          setEnv({
            support: "unsupported",
            isIOS,
            standalone,
            permission: "default",
          });
        }
        return;
      }

      const permission = Notification.permission;

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const sub = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setEnv({ support: "ok", isIOS, standalone, permission });
        setSubscribed(Boolean(sub));
      } catch (err) {
        console.error("[push] no se pudo registrar el service worker:", err);
        if (!cancelled) {
          setEnv({ support: "unsupported", isIOS, standalone, permission });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!vapidPublicKey) {
      toast.error("Faltan las claves VAPID en el servidor.");
      return;
    }
    setBusy(true);
    try {
      // El permiso tiene que pedirse dentro del gesto del usuario: por eso va
      // acá, en el click, y no en un efecto.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        toast.error(
          result === "denied"
            ? "Bloqueaste las notificaciones. Habilitalas desde los ajustes del teléfono."
            : "No se otorgó el permiso.",
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      // Si ya había una suscripción vieja la reusamos: volver a suscribirse
      // con otra clave tira InvalidStateError.
      const existing = await registration.pushManager.getSubscription();
      const sub =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: null }));
        throw new Error(error ?? "No pudimos guardar la suscripción.");
      }

      setSubscribed(true);
      toast.success("Notificaciones activadas en este dispositivo.");
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "No pudimos activar las notificaciones.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notificaciones apagadas en este dispositivo.");
    } catch (err) {
      console.error(err);
      toast.error("No pudimos desactivarlas.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Falló el envío.");
      if (!data?.sent) {
        toast.error("No hay dispositivos suscriptos para avisar.");
        return;
      }
      toast.success(
        data.sent === 1
          ? "Enviada. Debería aparecer en unos segundos."
          : `Enviada a ${data.sent} dispositivos.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falló el envío.");
    } finally {
      setBusy(false);
    }
  }

  // En iPhone, mientras la app se abra desde Safari, `PushManager` existe pero
  // suscribirse falla. Se avisa antes de que apriete el botón.
  const needsInstall = isIOS && !standalone;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-full bg-amber-50 grid place-items-center">
            <Bell className="size-5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">Notificaciones</h2>
            <p className="text-xs text-muted-foreground">
              {subscribed
                ? "Activadas en este dispositivo"
                : "Avisos de WhatsApp e Instagram en el teléfono"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {subscribed ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={sendTest}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BellRing className="size-4" />
                )}
                Probar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={disable}
                disabled={busy}
                className="text-destructive hover:text-destructive"
              >
                <BellOff className="size-4" />
                Apagar
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={enable}
              disabled={busy || support !== "ok" || needsInstall}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bell className="size-4" />
              )}
              Activar
            </Button>
          )}
        </div>
      </div>

      <div className="px-5 py-4 space-y-3 text-sm">
        {support === "unsupported" ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlert className="size-4 mt-0.5 shrink-0 text-amber-600" />
            Este navegador no soporta notificaciones push. En iPhone hace falta
            iOS 16.4 o más nuevo.
          </p>
        ) : null}

        {needsInstall ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1.5">
            <p className="flex items-center gap-1.5 font-medium">
              <Share className="size-3.5" />
              Primero agregá Zenna a la pantalla de inicio
            </p>
            <p>
              En iPhone las notificaciones solo funcionan con la app instalada.
              Abrí este sitio en Safari, tocá el botón de compartir, elegí{" "}
              <strong>Agregar a inicio</strong> y volvé a esta pantalla desde el
              ícono de Zenna para activarlas.
            </p>
          </div>
        ) : null}

        {permission === "denied" ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlert className="size-4 mt-0.5 shrink-0 text-rose-600" />
            Las notificaciones están bloqueadas para este sitio. Habilitalas en
            Ajustes → Notificaciones → Zenna y volvé a intentar.
          </p>
        ) : null}

        {!vapidPublicKey ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlert className="size-4 mt-0.5 shrink-0 text-rose-600" />
            Falta configurar <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> y{" "}
            <code>VAPID_PRIVATE_KEY</code> en el servidor.
          </p>
        ) : null}

        <p className="flex items-start gap-2 text-muted-foreground">
          <SmartphoneNfc className="size-4 mt-0.5 shrink-0" />
          El permiso se pide por dispositivo: si querés que suene también en la
          tablet o en la compu, entrá desde ahí y activalas de nuevo.
        </p>
      </div>
    </div>
  );
}
