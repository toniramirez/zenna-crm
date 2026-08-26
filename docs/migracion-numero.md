# Migración al número nuevo (WhatsApp Cloud API)

El salón cambió de número de WhatsApp. Los dos siguen conectados, pero ya no
son pares:

| | Número viejo — Baileys (`whatsapp`) | Número nuevo — Cloud API (`whatsapp_cloud`) |
|---|---|---|
| Rol | archivo + redirección | **canal principal** |
| Bandeja | a un botón de distancia | la que se abre en /crm |
| Automatizaciones | ninguna | **todas** |
| Turnero ("Mandar WhatsApp") | no | sí |
| Encuestas de reseña | no | sí |
| Respuesta automática | solo el aviso de redirección | ninguna propia |
| Se puede responder a mano | sí | sí |

Instagram (`instagram`) no cambió: comparte la bandeja principal como antes.

La decisión de qué canal es cuál vive en **`lib/channels.ts`**. Es el único
lugar donde están escritos los nombres de los canales: el día que se apague
Baileys se toca ahí.

## Puesta en marcha

1. **SQL** — correr `scripts/sql/whatsapp-migration.sql` y
   `scripts/sql/whatsapp-template-editor.sql` en el SQL Editor de Supabase
   (idempotentes). Requieren haber corrido antes `whatsapp-cloud-api.sql`.
2. **Conectar el número nuevo** — Configuración → *WhatsApp API*. Ver
   [`docs/whatsapp-api.md`](./whatsapp-api.md) para el detalle de credenciales
   y webhook.
3. **Plantillas** — en el mismo panel: *Nueva* para armarlas ahí (se mandan a
   Meta y quedan pendientes de aprobación) o *Sincronizar* para traer las que
   ya existan en el WhatsApp Manager. Sin plantillas aprobadas las
   automatizaciones solo alcanzan a quien haya escrito en las últimas 24 h
   (ver abajo).
4. **Configurar la redirección** — Configuración → *WhatsApp · número viejo* →
   *Redirección al número nuevo*: activarla, cargar el número nuevo tal como se
   quiere que se lea, y ajustar el mensaje. Con "Repetir cada" en `0` contesta
   cada vez que alguien escriba.
5. **Workers** — los dos tienen que estar corriendo:
   `pm2 start ecosystem.config.js` levanta `zenna-worker` (viejo) y
   `zenna-wpp-api` (nuevo).
6. **Pasar las automatizaciones a plantilla** — CRM → Configuración →
   Automatizaciones. Cada flujo que se dispare sobre un turno debería quedar en
   modo *Plantilla aprobada*; si queda en *Mensaje libre*, ver la sección
   siguiente.

## La ventana de 24 h, y por qué importa acá

La Cloud API solo acepta texto libre dentro de las 24 h posteriores al último
mensaje del cliente. Fuera de esa ventana la única forma de escribir es una
**plantilla aprobada** por Meta, que además reabre la conversación.

Un recordatorio "24 h antes del turno" casi nunca cae dentro de la ventana: la
clienta reservó hace dos semanas. Por eso cada flujo elige cómo se manda:

- **Mensaje libre** — el `message_body` de siempre. Llega solo si la clienta
  escribió hace poco. Sirve para el trigger de *mensaje entrante*, donde la
  ventana está abierta por definición.
- **Plantilla aprobada** — se elige una del WABA y se dice qué va en cada
  `{{1}}`, `{{2}}`… Los valores son las mismas variables del CRM
  (`{{nombre}}`, `{{servicio}}`, `{{fecha}}`, `{{hora}}`, `{{profesional}}`) o
  texto fijo, y se resuelven al disparar el flujo.

Lo mismo aplica al **pedido de reseña**: la pregunta sale horas después de
cobrar el turno, así que necesita plantilla. Las tres respuestas por puntaje
no: contestan a un mensaje que acaba de entrar.

Las plantillas se arman en **Configuración → WhatsApp API → Plantillas** (ver
[`docs/whatsapp-api.md`](./whatsapp-api.md)) y las aprueba Meta, lo que tarda
minutos u horas. El selector ofrece solo las que el CRM sabe armar (texto, con
o sin variables, y botones estáticos); las de cabecera multimedia o botón con
URL dinámica —que solo pueden venir del WhatsApp Manager— quedan afuera.

Si la plantilla se armó desde el CRM sus variables se llaman igual que las del
CRM (`{{nombre}}`, `{{fecha}}`…), y el mapeo de cada `{{…}}` viene precargado
al elegirla.

## Cómo llega una automatización a alguien que nunca escribió al número nuevo

Después de la migración casi ninguna clienta tiene chat en el número nuevo: su
historial está en el viejo. `resolveCloudConversation`
(`lib/whatsapp-cloud/conversations.ts`) resuelve eso:

1. busca por clienta vinculada,
2. si no, por los últimos 8 dígitos del teléfono — Meta devuelve los números
   argentinos **sin el 9**, así que comparar el número entero abriría un chat
   duplicado por cada forma de escribirlo,
3. si no existe **y el flujo manda plantilla**, lo crea con `external_id` =
   los dígitos del número. Cuando la clienta conteste, el webhook cae sobre esa
   misma fila.

Un flujo en modo texto libre **no** abre chats: el envío rebotaría igual y solo
ensuciaría la bandeja. La ejecución queda en `skipped` con el motivo.

## Dónde corre cada cosa

| | Proceso | Archivo |
|---|---|---|
| Entrantes del número nuevo + acuses | Next (webhook) | `app/api/whatsapp/webhook/route.ts` → `lib/whatsapp-cloud/ingest.ts` |
| Automatizaciones de entrada y encuestas | Next (webhook) | `runInboundHooks` en `lib/whatsapp-cloud/ingest.ts` |
| Reloj de automatizaciones (cada 60 s) | `zenna-wpp-api` | `worker/whatsapp-cloud.ts` |
| Salientes del número nuevo | `zenna-wpp-api` | `worker/whatsapp-cloud.ts` |
| Entrantes/salientes del número viejo | `zenna-worker` | `worker/baileys.ts` |
| Aviso de redirección | `zenna-worker` | `maybeSendRedirect` en `worker/baileys.ts` |
| Crear/editar/borrar plantillas | Next (server action) | `app/(dashboard)/configuracion/whatsapp-cloud-actions.ts` |

El reloj de las automatizaciones vivía en el worker de Baileys, que era el
único proceso permanente cuando el número viejo era el principal. Se mudó: si
se quedara ahí, los recordatorios dependerían de que el socket de un número que
ya no usamos siguiera vivo.

## Diagnóstico

- **"No salió el recordatorio"** → mirar `automation_executions` de ese flujo.
  `skipped` con motivo = no había chat en el número nuevo (flujo en modo texto,
  o teléfono sin cargar en la ficha). `failed` = la plantilla no está aprobada,
  o una variable quedó vacía (un turno sin profesional, por ejemplo).
- **"Meta rechazó la plantilla"** → el motivo queda escrito en la fila de la
  plantilla, en Configuración. Casi siempre es la categoría (un recordatorio de
  turno es *Utilidad*, no *Marketing*) o un texto que suena a promoción.
- **"Manda todo pero no llega"** → ¿está corriendo `zenna-wpp-api`? ¿El panel
  de WhatsApp API dice Conectado? Un flujo en modo texto libre fuera de la
  ventana queda en rojo en el chat con el motivo de Meta (error 131047).
- **"El número viejo no contesta el aviso"** → la redirección se apaga sola si
  el mensaje usa `{{numero}}` y no hay número cargado; queda un warning
  `[redirect]` en los logs de `zenna-worker`. La config se relee como mucho una
  vez por minuto, así que un cambio del panel puede tardar eso en aplicarse.
- **"Aparecieron chats duplicados de la misma clienta"** → esperado y correcto:
  el chat viejo (Baileys) y el nuevo (Cloud API) son dos números distintos, y
  viven en bandejas distintas.
