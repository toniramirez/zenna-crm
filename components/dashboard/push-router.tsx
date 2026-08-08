"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { emitOpenConversation } from "@/lib/push/open-conversation";

/**
 * Puente entre el service worker y el router.
 *
 * Cuando se toca una notificación con la app ya abierta, `public/sw.js` manda
 * acá la URL en vez de navegar él: `client.navigate()` no existe en iOS —el
 * caso principal, la PWA en el iPhone— y ahí el toque terminaba dejando la app
 * donde estaba en vez de abrir el chat.
 *
 * Se monta en el layout del dashboard para que funcione desde cualquier
 * pantalla, no solo desde la bandeja. No pinta nada.
 */
export function PushRouter() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (
        !data ||
        data.type !== "zenna:navigate" ||
        typeof data.url !== "string" ||
        // Solo rutas propias. El mensaje viene de nuestro service worker, pero
        // mandar cualquier cosa al router es una redirección abierta.
        !data.url.startsWith("/")
      ) {
        return;
      }

      // Contestar antes de navegar: el service worker espera el acuse para
      // saber que no tiene que recurrir a recargar la página él mismo.
      event.ports[0]?.postMessage({ ok: true });

      // La bandeja ya montada no se entera de un cambio de query string: su
      // selección es estado de React. Se le avisa aparte.
      const conversationId = new URL(
        data.url,
        window.location.origin,
      ).searchParams.get("c");
      if (conversationId) emitOpenConversation(conversationId);

      // Igual navegamos: si el usuario estaba en Turnos o en Caja, esto lo
      // lleva al CRM, y ahí la conversación llega por la URL.
      router.push(data.url);
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [router]);

  return null;
}
