/*
 * Service worker de Zenna. Existe por una sola razón: en iOS las
 * notificaciones push solo llegan a través de un service worker, y solo si la
 * app está agregada a la pantalla de inicio (iOS 16.4+).
 *
 * A propósito NO cachea nada: el CRM necesita datos frescos y un caché mal
 * invalidado sería peor que no tener offline.
 */

// Tomar el control apenas se instala, sin esperar a que se cierren las
// pestañas viejas: si no, la primera activación no recibe pushes.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Payload no-JSON: lo mostramos como texto pelado antes que perderlo.
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Zenna";
  const options = {
    body: data.body || "Tenés un mensaje nuevo.",
    icon: data.icon || "/zenna-logo.png",
    badge: "/zenna-logo.png",
    // `tag` agrupa: varios mensajes de la misma conversación reemplazan la
    // notificación anterior en vez de apilar una por mensaje.
    tag: data.tag || "zenna-mensaje",
    renotify: true,
    // Sin esto iOS junta todo en silencio; con vibración se siente el aviso.
    vibrate: [80, 40, 80],
    data: { url: data.url || "/crm" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/crm";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Si la app ya está abierta la enfocamos y la llevamos al chat, en vez
      // de abrir una segunda ventana.
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // Algunas versiones de Safari rechazan navigate(): con el focus
              // alcanza, la app ya está en pantalla.
            }
          }
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});

/*
 * Apple/Google pueden rotar la suscripción por su cuenta. Cuando pasa, el
 * navegador dispara este evento: nos volvemos a suscribir con la misma clave
 * pública y avisamos al servidor para que reemplace el endpoint viejo.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || null;
      const applicationServerKey =
        (event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null) || null;
      if (!applicationServerKey) return;

      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: fresh.toJSON(),
          oldEndpoint: old ? old.endpoint : null,
        }),
      });
    })(),
  );
});
