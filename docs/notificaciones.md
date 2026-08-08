# Notificaciones push en el teléfono

Cuando entra un mensaje de WhatsApp o de Instagram, el CRM manda una
notificación a los dispositivos que la tengan activada — aunque la app esté
cerrada. Es Web Push estándar (VAPID), sin servicios de terceros ni costo.

## Cómo está armado

```
 WhatsApp ──▶ worker/baileys.ts ────┐
                                    ├──▶ lib/push/send.ts ──▶ Apple / Google ──▶ 📱
 Instagram ─▶ lib/instagram/ingest ─┘         │
                                              ▼
                                     push_subscriptions
                                     (un renglón por dispositivo)
```

- `public/sw.js` es el service worker: recibe el push y muestra el aviso. No
  cachea nada — el CRM necesita datos frescos.
- `lib/push/send.ts` se importa desde los dos caminos de entrada. No usa nada
  de Next a propósito: el worker de WhatsApp corre suelto con `tsx`.
- Un aviso por conversación (`tag`): cinco mensajes seguidos de la misma
  persona dejan una sola notificación, no cinco.
- El ícono es un globo de mensaje con el color del canal (verde de WhatsApp,
  degradé de Instagram), no el logo de Zenna: en la bandeja del teléfono lo que
  hay que reconocer de un vistazo es de qué se trata el aviso. Están en
  `public/icons/`. En iPhone iOS ignora este ícono y muestra el de la app
  instalada — no hay forma de cambiarlo.

## El toque abre el chat

Siempre termina en `/crm?c=<conversación>`, con la clienta que escribió ya
abierta. Cómo llega ahí depende de si la app estaba abierta:

- **Cerrada** → `openWindow()` con esa URL, y la bandeja arranca con esa
  conversación seleccionada (`initialSelectedId`).
- **Abierta** → el service worker le pasa la URL a la app por `postMessage` y
  navega el router de Next (`components/dashboard/push-router.tsx`). Es por acá
  y no por `client.navigate()` porque en iOS `navigate()` no existe: el toque
  dejaba la app donde estaba. Si el mensaje no tiene respuesta en 500 ms —una
  pestaña vieja, de antes de este puente— recién ahí se usa `navigate()`.

Con la bandeja ya abierta, además del `router.push` va un evento
(`lib/push/open-conversation.ts`) que cambia la conversación seleccionada: esa
selección es estado de React y no se entera sola de un cambio en la URL.

## Puesta en marcha

### 1. Tabla en Supabase

Correr `scripts/sql/push-notifications.sql` en el SQL Editor. Es idempotente.

### 2. Claves VAPID

Ya están generadas en `.env.local`. Para un entorno nuevo:

```bash
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"
```

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:zennahairsalon@gmail.com
```

⚠️ Las tres variables tienen que estar **también en Railway** (Variables del
servicio) y en el proceso del worker de WhatsApp. Si cambiás las claves, todas
las suscripciones existentes dejan de servir y hay que volver a activar las
notificaciones en cada teléfono.

### 3. Activarlas en cada dispositivo

En **Configuración → Avisos en el teléfono**, botón *Activar*. El permiso es
por dispositivo: si querés que suene en el iPhone y en la compu, hay que
activarlo desde cada uno.

## iPhone: los tres requisitos

iOS es el más exigente y falla en silencio si falta alguno:

1. **iOS 16.4 o más nuevo.**
2. **La app agregada a la pantalla de inicio.** En Safari: compartir →
   *Agregar a inicio*. Desde Safari a secas el permiso ni se puede pedir.
3. **El permiso otorgado desde dentro de la app instalada**, entrando por el
   ícono de Zenna y no por el navegador.

El panel de Configuración detecta el caso 2 y muestra las instrucciones en vez
de un botón que no haría nada.

## Probar que anda

El botón *Probar* del panel manda una notificación a los dispositivos del
usuario que la pide. Si llega, el circuito completo está bien: claves, service
worker, permiso y suscripción guardada.

## Si no llegan

- **Nada llega a ningún dispositivo** → faltan las claves VAPID en el server.
  El panel lo avisa; en los logs aparece `[push] Falta NEXT_PUBLIC_VAPID…`.
- **Llegan al navegador pero no al iPhone** → casi siempre es el requisito 2:
  la app no está instalada en la pantalla de inicio.
- **Dejaron de llegar de golpe** → el navegador rotó la suscripción. El service
  worker se resuscribe solo (`pushsubscriptionchange`) y avisa a
  `/api/push/subscribe`. Si igual no vuelve, apagar y volver a activar.
- Los endpoints muertos (404/410) se borran solos de `push_subscriptions` en el
  primer envío que falle.

## Local

Web Push necesita HTTPS. Para probar en la máquina:

```bash
npx next dev --experimental-https
```
