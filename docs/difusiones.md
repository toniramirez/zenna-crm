# Difusiones

Un mismo mensaje por WhatsApp (canal `whatsapp_cloud`) a un segmento de
clientas armado con filtros. Se arma en **CRM → Configuración → Difusiones**
y lo manda el worker de la Cloud API. A cada clienta le llega en su propio
chat, como un mensaje individual (no es una "lista de difusión" de WhatsApp).

## Puesta en marcha

1. **SQL**: correr `scripts/sql/broadcasts.sql` en el SQL Editor de Supabase
   (es idempotente). Requiere `whatsapp-cloud-api.sql` y
   `whatsapp-window-countdown.sql`.
2. **Worker**: reiniciar `zenna-wpp-api` (`pm2 restart zenna-wpp-api`). El
   reloj de difusiones vive en `worker/whatsapp-cloud.ts`.

Mientras no se corra el SQL, la pestaña se ve vacía y el resto de /crm sigue
funcionando.

## Filtros

Las **condiciones** dicen quiénes entran y se combinan con "todas" o
"alguna". Sin condiciones entran todas las clientas con teléfono.

| Filtro | Qué mira |
|---|---|
| Etiquetas | `clients.tags`: tiene alguna / todas las elegidas |
| Última visita | `clients.last_visit_at`: dentro de N días, hace más de N días, o nunca |
| Servicios | turnos pasados (no cancelados ni ausentes) con alguno de esos servicios, opcionalmente en un período |
| Profesional | ídem, por profesional de cada servicio (`appointment_services.professional_id`) |
| Cantidad de visitas | `clients.total_visits` entre mín. y máx. |
| Gasto total | `clients.total_spent` entre mín. y máx. |
| Cumpleaños | mes de `clients.birthday` |
| Clientas nuevas | `clients.created_at` dentro de N días |
| Turno agendado | tiene / no tiene un turno futuro `scheduled` o `confirmed` |
| Chat reciente | escribió al número nuevo en las últimas 24 h (las únicas a las que les llega texto libre) |

Las **exclusiones** se aplican siempre, sin importar "todas/alguna":

- clientas con ciertas etiquetas (ej. crear una "No molestar");
- clientas que recibieron otra difusión en los últimos N días.

El segmento lo calcula `lib/broadcasts/audience.ts`, el mismo código para la
vista previa del editor y para el worker. Además:

- **Sin teléfono** → afuera.
- **Mismo número en dos fichas** (últimos 8 dígitos) → un solo mensaje.
- **Teléfono sin código de país** (10 dígitos o menos, o empieza con 0) y sin
  chat previo en el número nuevo → se saltea con el motivo anotado. Con chat
  previo sí sale: se le escribe al `wa_id` que dio Meta, no al de la ficha.
  La vista previa avisa cuántas son; se arregla corrigiendo la ficha
  (ej. `+54 9 351 …`).

## Mensaje

Mismo bloque que las automatizaciones (`FlowTemplateFields`):

- **Plantilla aprobada** (default): llega a cualquiera. Meta la cobra según su
  categoría.
- **Mensaje libre**: solo llega a quien escribió en las últimas 24 h; al resto
  la difusión la saltea y lo deja anotado.

La única variable es `{{nombre}}` (nombre de pila). Las de turno (`{{fecha}}`,
`{{servicio}}`…) se rechazan al guardar porque no tienen de dónde salir.

## Envío

```
draft ──programar/enviar ahora──▶ scheduled ──worker──▶ sending ──▶ completed
  ▲                                  │                     │
  └──────────── desprogramar ────────┘                     └─ cancelar ─▶ cancelled
```

- "Enviar ahora" es programar para ya: hay un solo camino hasta el worker.
- Al arrancar, el worker **saca la foto del segmento** en
  `broadcast_recipients` (con nombre y teléfono copiados). Una difusión
  programada para el viernes incluye a quien se etiquetó el jueves.
- Antes de la foto valida la plantilla una vez: si Meta la despublicó, la
  difusión vuelve a borrador con el motivo en vez de fallar destinataria por
  destinataria.
- **De a poco**: solo encola mientras haya menos de 20 mensajes de la Cloud
  API esperando en la cola, así una respuesta escrita a mano en la bandeja no
  queda detrás de toda la promo.
- **De 9 a 21 h** (hora del salón), como los seguimientos automáticos. Lo que
  queda pendiente a las 21 sigue a las 9.
- Sin cuenta de WhatsApp API conectada, espera en vez de fallar.
- Los mensajes salen con `sent_by = null`, como todo lo del worker: el flujo
  "la clienta no contestó" no persigue a nadie por no responder una promo.

**Cancelar** una que está saliendo cierra las pendientes y anula (con
`revoked_at`) los mensajes que estaban en cola sin salir. Lo que Meta ya
recibió no se puede borrar.

## Números

`broadcast_stats` (vista) cruza la cola con los acuses de `messages`. Las
categorías son excluyentes — pendientes, en cola, enviados, entregados,
leídos, fallidos, omitidos — más **respondieron**: la clienta escribió al
chat después de que le salió la difusión. El panel se refresca solo cada 5 s
mientras hay alguna programada o saliendo.

## Archivos

| | |
|---|---|
| `scripts/sql/broadcasts.sql` | tablas, vista y RLS |
| `lib/broadcasts/filters.ts` | forma y validación de los filtros (puro) |
| `lib/broadcasts/audience.ts` | cálculo del segmento |
| `lib/broadcasts/load.ts` | lista con números para el panel |
| `lib/validations/broadcasts.ts` | validación del formulario |
| `app/(dashboard)/crm/broadcast-actions.ts` | server actions |
| `app/(dashboard)/crm/broadcasts-manager.tsx` | pestaña y tarjetas |
| `app/(dashboard)/crm/broadcast-dialog.tsx` | editor |
| `app/(dashboard)/crm/broadcast-filters-editor.tsx` | armado del segmento |
| `app/(dashboard)/crm/broadcast-recipients-dialog.tsx` | detalle por clienta |
| `worker/broadcasts.ts` | arranque y vaciado de la cola |
