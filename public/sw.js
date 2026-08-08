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
    // El ícono lo elige quien manda el push (verde de WhatsApp, degradé de
    // Instagram). El de acá es el genérico: un globo de mensaje, no el logo
    // de Zenna — en la bandeja del teléfono lo que importa es de qué se trata
    // el aviso, no de qué app viene.
    icon: data.icon || "/icons/message.png",
    // Android lo pinta de un solo color en la barra de estado: tiene que ser
    // una silueta, no una foto.
    badge: "/icons/badge.png",
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

/**
 * Le pide a la app abierta que navegue ella misma. Devuelve false si nadie
 * contesta a tiempo —una pestaña vieja, de antes de que existiera el puente—
 * para poder recurrir al plan B.
 */
function askClientToNavigate(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: "zenna:navigate", url }, [channel.port2]);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/crm";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const open = all.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      // App cerrada: se abre directo en la conversación.
      if (!open) {
        await self.clients.openWindow(target);
        return;
      }

      // El foco va primero y sin nada await de por medio: consume la
      // activación que dejó el toque, y si esperamos algo antes se pierde.
      await open.focus();

      // Que navegue la app con su propio router: es instantáneo, no recarga
      // nada y —sobre todo— anda en iOS, donde `client.navigate()` no existe.
      if (await askClientToNavigate(open, target)) return;

      // Plan B para una pestaña que no responde el mensaje.
      if ("navigate" in open) {
        try {
          await open.navigate(target);
          return;
        } catch {
          // Algunas versiones de Safari lo rechazan: queda el openWindow.
        }
      }

      try {
        await self.clients.openWindow(target);
      } catch {
        // Sin permiso para abrir ventana: al menos quedó la app enfocada.
      }
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
