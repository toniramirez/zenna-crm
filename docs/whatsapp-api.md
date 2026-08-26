# WhatsApp Cloud API (canal `whatsapp_cloud`)

Canal oficial de Meta para WhatsApp, y **el canal principal del CRM** desde la
migración de número. Convive con el canal `whatsapp` de Baileys —son dos
números distintos— pero no como pares: Baileys quedó como archivo del número
viejo, en su propia bandeja. Ver
[`docs/migracion-numero.md`](./migracion-numero.md).

| | Baileys (`whatsapp`) | Cloud API (`whatsapp_cloud`) |
|---|---|---|
| Conexión | QR del teléfono | Token + IDs de Meta |
| Texto libre | siempre | solo dentro de la ventana de 24 h |
| **Plantillas aprobadas** | no | **sí** (reabren la conversación) |
| Automatizaciones / turnero | no (archivo) | **sí** |
| Editar / eliminar para todos | sí | no (la API no lo permite) |
| Acuses sent/delivered/read | sí | sí (por webhook) |
| Notas de voz del CRM (webm) | sí | no (Meta no acepta webm) |

## Arquitectura

- **Entrantes y acuses** → `app/api/whatsapp/webhook/route.ts` (webhook de
  Meta, firma HMAC `X-Hub-Signature-256`). Persiste vía
  `lib/whatsapp-cloud/ingest.ts` con el cliente service_role.
- **Salientes** → `worker/whatsapp-cloud.ts` (pm2: `zenna-wpp-api`), que
  drena `messages` con `status='queued'` y `conversations.channel='whatsapp_cloud'`.
  Todo lo que ya encola mensajes funciona sin cambios.
- **Credenciales** → tabla `whatsapp_cloud_accounts` (service_role-only).
- **Plantillas** → tabla `whatsapp_templates`, caché de lo que hay en el
  WhatsApp Manager. Se sincroniza desde Configuración y se actualiza sola
  cuando Meta avisa por webhook (`message_template_status_update`).
- Las conversaciones se identifican por `(channel='whatsapp_cloud',
  external_id=<dígitos del número>)`. El `wa_id` de Meta ya son los dígitos.

## Puesta en marcha

1. **SQL**: correr `scripts/sql/whatsapp-cloud-api.sql` en el SQL Editor de
   Supabase (idempotente).
2. **App de Meta**: producto *WhatsApp* agregado (puede ser la misma app que
   usa Instagram). Anotar del **App Dashboard → WhatsApp → API Setup**:
   - *Phone Number ID* (no es el número de teléfono),
   - *WhatsApp Business Account ID* (WABA),
   - un **token permanente**: Meta Business Suite → Configuración del negocio
     → Usuarios → Usuarios del sistema → crear uno con acceso a la app y al
     WABA, y generar token con `whatsapp_business_messaging` +
     `whatsapp_business_management`.
3. **Variables de entorno** (`.env.local`):
   - `WHATSAPP_APP_SECRET` — app secret para validar la firma del webhook.
     *Opcional si ya está `INSTAGRAM_APP_SECRET` y es la misma app de Meta:
     el código cae en esa automáticamente.* Acepta varios separados por coma.
   - `WHATSAPP_VERIFY_TOKEN` — token inventado para el handshake del webhook.
     También cae en `INSTAGRAM_VERIFY_TOKEN` si no está.
   - `WHATSAPP_API_VERSION` — opcional, default `v25.0`.
   - Ya existentes: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. **Webhook**: App Dashboard → WhatsApp → Configuration → Webhooks:
   - Callback URL: `https://<dominio>/api/whatsapp/webhook` (el panel de
     Configuración la muestra para copiar),
   - Verify Token: el de `WHATSAPP_VERIFY_TOKEN`,
   - suscribirse a los campos **messages** y
     **message_template_status_update**.
5. **Conectar**: CRM → Configuración → *WhatsApp API* → pegar token, Phone
   Number ID y WABA ID. Se valida contra Meta antes de guardar y sincroniza
   las plantillas.
6. **Worker**: `npm run worker:wpp-api` (dev) o pm2 (`zenna-wpp-api` ya está
   en `ecosystem.config.js`).

## La ventana de 24 h

Meta solo acepta texto/archivos libres dentro de las 24 h posteriores al
último mensaje del cliente (error 131047 fuera de eso; acá no existe el
`HUMAN_AGENT` de Instagram). El CRM lo maneja en tres capas:

1. **Composer**: con la ventana cerrada, el campo de texto se reemplaza por el
   botón "Enviar plantilla".
2. **Worker**: antes de enviar texto libre chequea la ventana y falla rápido
   con un error claro, sin gastar el viaje a Meta.
3. **Webhook**: si igual se escapó uno (carrera justo en el límite), el acuse
   `failed` de Meta se traduce a un error legible en la burbuja.

Las plantillas se crean en el **WhatsApp Manager** de Meta (no desde el CRM) y
tardan minutos u horas en aprobarse. El selector del chat ofrece solo las
aprobadas; las de cabecera multimedia o botón con URL dinámica aparecen
deshabilitadas (todavía no se piden esos parámetros).

## Decisiones deliberadas (mientras convivan los dos canales)

- **El turnero y las automatizaciones salen por acá.** El texto libre muere
  fuera de la ventana de 24 h, así que cada flujo elige entre mensaje libre y
  plantilla aprobada (`automation_flows.send_mode`); un recordatorio de turno
  necesita plantilla. El detalle está en
  [`docs/migracion-numero.md`](./migracion-numero.md).
- **Entrega "al menos una vez"**: si Meta acepta un envío pero la respuesta se
  pierde (timeout, 502), el mensaje se reintenta y puede llegar duplicado.
  Mismo criterio que el worker de Instagram; la Cloud API no ofrece clave de
  idempotencia.
- Un mensaje que quede >15 min en `sending` (worker reiniciado a mitad de
  envío) se marca fallido con el motivo a la vista, **no** se reintenta solo:
  reintentarlo podría duplicarlo si en realidad había salido.

## Diagnóstico

- *"El webhook contesta 200 pero no aparece nada"* → falta
  `SUPABASE_SERVICE_ROLE_KEY` o la firma no valida (ver logs de
  `[whatsapp/webhook]`; loguea el fingerprint del secret que cerró).
- *"No sale nada"* → ¿está corriendo `zenna-wpp-api`? ¿El panel dice
  Conectado? El worker loguea al arrancar si la cuenta no está lista.
- Mensajes encolados >6 h (worker caído) se marcan fallidos en vez de salir
  tarde, igual que en Instagram.
- El estado de un envío vive en la burbuja: reloj = en cola, tildes = como
  WhatsApp, rojo con el motivo = rechazado por Meta.
