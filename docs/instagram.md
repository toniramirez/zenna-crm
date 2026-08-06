# Instagram (Meta) — DMs en la bandeja del CRM

Los mensajes directos de Instagram entran a `/crm`, la misma bandeja que
WhatsApp. Se distinguen por un badge de Instagram en el avatar.

## Cómo está armado

```
                        ┌──────────────────────────────┐
 Meta ── webhook ──────▶│ POST /api/instagram/webhook  │
 (mensajes entrantes)   │  · valida firma HMAC         │
                        │  · responde 200 al toque     │
                        │  · ingesta en background     │
                        └──────────────┬───────────────┘
                                       ▼
                              conversations + messages
                              (channel='instagram')
                                       ▲
                        ┌──────────────┴───────────────┐
 Meta ◀── Graph API ────│ worker/instagram.ts          │
 (mensajes salientes)   │  · drena status='queued'     │
                        └──────────────────────────────┘
```

Lo importante: **la salida no tiene código nuevo del lado de la app**. La
bandeja, las respuestas rápidas y los envíos masivos ya insertan filas en
`messages` con `status='queued'`; el worker de Instagram drena las que
pertenecen a conversaciones con `channel='instagram'`. Cualquier cosa que hoy
sepa encolar un mensaje funciona en Instagram sin cambios.

Los contadores de la conversación (`last_message_at`, `unread_count`,
`awaiting_reply`) los mantiene un trigger de la base sobre `messages`, así que
también son agnósticos del canal.

## Requisitos del lado de Meta

1. Cuenta de Instagram **profesional** (Empresa o Creador). Una cuenta personal
   no puede recibir mensajes por API.
2. Una app en [developers.facebook.com](https://developers.facebook.com) con el
   producto **Instagram** agregado.
3. Permisos: `instagram_business_basic` e
   `instagram_business_manage_messages`.
   - Para responder fuera de la ventana de 24 h hace falta además el permiso
     `human_agent`, que se pide en App Review.
4. En modo desarrollo solo funciona con las cuentas que estén cargadas como
   testers de la app. Para operar con clientas reales hay que pasar App Review.

## Puesta en marcha

### 1. Base de datos

Correr una sola vez en el SQL Editor de Supabase:

```
scripts/sql/instagram-integration.sql
```

Crea `instagram_accounts`, habilita `channel='instagram'` y agrega los índices
únicos que hacen idempotente al webhook.

### 2. Variables de entorno

En Railway (y en `.env.local` para desarrollo):

| Variable | Para qué sirve |
| --- | --- |
| `INSTAGRAM_APP_SECRET` | Valida la firma `X-Hub-Signature-256`. **Sin esto el webhook rechaza todo.** Es el de **Configuración de la app → Básica**, no el de Instagram → Configuración de la API: son dos secrets distintos y el que firma los webhooks es el primero. |
| `INSTAGRAM_VERIFY_TOKEN` | String inventado por vos. Tiene que coincidir con el que se carga en el App Dashboard. |
| `NEXT_PUBLIC_APP_URL` | URL pública del deploy, ej. `https://zenna.up.railway.app`. Se usa para mostrar la Callback URL. |
| `INSTAGRAM_API_VERSION` | Opcional. Default `v25.0`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya existía para el worker de WhatsApp; ahora también la usa el webhook. |

> `INSTAGRAM_VERIFY_TOKEN` puede ser cualquier cosa larga y aleatoria — no lo
> emite Meta, es un secreto compartido que solo sirve para el handshake inicial.

### 3. Webhook en el App Dashboard

En **Instagram → Configuración de webhooks**:

- **Callback URL**: `https://TU-DOMINIO/api/instagram/webhook`
  (el panel de Configuración del CRM la muestra lista para copiar)
- **Verify Token**: el valor de `INSTAGRAM_VERIFY_TOKEN`
- **Campo a suscribir**: `messages`

Meta hace un `GET` con `hub.challenge` en ese momento. Si el deploy está arriba
y las variables cargadas, verifica solo.

### 4. Conectar la cuenta

En el CRM: **Configuración → Instagram → Conectar**. Se pega el token de acceso
de Instagram y el sistema lo valida contra Meta antes de guardarlo.

Si el token es de corta duración, se cambia automáticamente por uno de 60 días
(hace falta `INSTAGRAM_APP_SECRET`). El worker lo renueva solo cuando le quedan
menos de 10 días.

El token vive en `instagram_accounts`, que está cerrada por RLS: solo se lee con
`service_role`. Nunca viaja al navegador.

### 5. Worker de salida

```bash
npm run worker:instagram        # desarrollo
pm2 start ecosystem.config.js   # producción (levanta zenna-instagram)
```

Sin este proceso los DMs **entran** igual (el webhook es parte de Next), pero
las respuestas quedan encoladas en `queued` sin salir.

## Cosas que conviene saber

**Ventana de 24 horas.** Instagram solo deja responder dentro de las 24 h desde
el último mensaje de la persona. Fuera de esa ventana el worker manda el mensaje
con la etiqueta `HUMAN_AGENT`, que estira el plazo a 7 días — pero eso requiere
el permiso `human_agent` aprobado. Sin él, Meta rechaza el envío y el mensaje
queda en `failed` con el motivo visible en la bandeja.

**No hay teléfono.** Una conversación de Instagram se identifica por IGSID, que
es un ID interno por app. No se puede cruzar con la base de clientas
automáticamente: la recepcionista vincula la clienta desde el chat (o se crea al
etiquetar). Por eso las conversaciones de Instagram arrancan sin `client_id`.

**Qué se puede enviar.** Texto, imagen, video, audio y archivos. Los stickers no
están soportados por la API. Las reacciones solo se pueden mandar como corazón
(❤️) — es limitación de Meta, aunque sí recibimos todas las que mandan del otro
lado.

**Adjuntos.** Las URLs que manda Meta caducan en horas, así que el webhook baja
cada archivo y lo guarda en el bucket `wa-media`, igual que WhatsApp. Para
enviar, se firma una URL temporal del bucket para que Meta pueda descargarla.

**Automatizaciones.** Siguen siendo solo de WhatsApp, a propósito: los
recordatorios de turno caen casi siempre fuera de la ventana de 24 h y rebotarían.

## Diagnóstico

| Síntoma | Dónde mirar |
| --- | --- |
| Meta no verifica el webhook | ¿`INSTAGRAM_VERIFY_TOKEN` coincide? ¿El deploy responde en esa URL? |
| `firma inválida` en los logs | `INSTAGRAM_APP_SECRET` no es el secret con el que Meta firma. Ojo: es el de Configuración → Básica, no el de Instagram → Configuración de la API. El log trae `secret=<largo>ch/<hash>` para comparar entornos sin exponer el valor. |
| No entra ningún mensaje | ¿Está suscripto el campo `messages`? ¿La cuenta hizo `POST /me/subscribed_apps?subscribed_fields=messages`? ¿Es tester de la app? |
| Los mensajes quedan en `queued` | El worker `zenna-instagram` no está corriendo. |
| Los mensajes quedan en `failed` | El motivo está en `messages.error` y en el panel de Configuración. |
| "El token venció" | Configuración → Instagram → Conectar de nuevo. |
