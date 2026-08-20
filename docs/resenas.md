# Pedido de reseña

Encuesta del 1 al 5 que sale sola por WhatsApp después de cobrar un turno. Un 5
manda a la clienta al link de Google; un puntaje bajo abre un caso interno en
`/resenas` para resolverlo en privado, antes de que se convierta en una reseña
pública de una estrella.

## Puesta en marcha

1. Correr `scripts/sql/review-flow.sql` en el SQL Editor de Supabase (una sola
   vez, es idempotente).
2. En **Mensajes → Configuración → Flujos**, botón **Pedido de reseña**. Poner
   nombre, el nombre del salón, el link de Google y dejarlo activo.
3. El worker de WhatsApp (`npm run worker`) tiene que estar corriendo: es quien
   dispara los envíos y quien lee las respuestas.

El link de Google se saca del perfil de la empresa: *Pedir reseñas* → copiar el
`https://g.page/r/…/review`. Sin ese campo cargado la respuesta al 5 sale con
un hueco, y el panel avisa en la tarjeta del flujo.

## Cómo funciona

```
cobro del turno ──(offset)──▶ pregunta 1-5 ──▶ respuesta de la clienta
                                                      │
                                     ┌────────────────┼────────────────┐
                                     ▼                ▼                ▼
                                     5              3 o 4            1 o 2
                              link de Google   "¿qué mejoramos?"  disculpas
                                     │                └───────┬───────┘
                                   nada                  caso interno
                                                        (puntaje ≤ 3)
```

- **Disparo.** `worker/automations.ts` corre cada minuto. Para el trigger
  `after_payment` entra por `payments.paid_at`, no por el turno: un turno del
  martes cobrado el jueves dispara el jueves.
- **Pregunta.** `worker/reviews.ts` inserta una fila en `review_requests` y
  encola el mensaje. El único `(flow_id, appointment_id)` es lo que evita
  preguntar dos veces.
- **Respuesta.** Cada mensaje entrante pasa primero por `processInboundReview`.
  Si hay una encuesta abierta en esa conversación (72 h) y el texto se
  interpreta como un puntaje, se contesta según el bucket y el mensaje queda
  *consumido*: las automatizaciones de mensaje entrante no vuelven a
  responderlo.
- **Feedback.** Lo primero que escribe después de un puntaje de 4 o menos (24 h)
  se pega al caso. Ese mensaje no se consume: sigue apareciendo en el chat como
  cualquier otro.

## Qué cuenta como puntaje

`parseReviewScore` en `lib/reviews.ts`. Acepta `"5"`, `"5!!"`, `"cinco"`,
`"cinco, gracias"`, `"le doy un 4"`, `"4 estrellas"`. Rechaza `"10"`,
`"4 o 5 no sé"` y cualquier frase con palabras que no sean relleno conocido.

Es deliberadamente conservador: perder una respuesta rara sólo significa que la
atiende una persona —el mensaje está en la bandeja igual—, mientras que un falso
positivo contesta una encuesta que nadie respondió y abre un caso inventado.

## Canales

Sólo WhatsApp propio (Baileys), igual que el resto de las automatizaciones.
Instagram tiene ventana de 24 h y la Cloud API exige plantilla aprobada fuera de
ella, así que una encuesta espontánea rebotaría.
