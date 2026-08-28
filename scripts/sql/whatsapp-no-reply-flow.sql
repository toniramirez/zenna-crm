-- ─────────────────────────────────────────────────────────────────────────
-- Flujo de seguimiento: la clienta no contestó.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Contexto: hasta ahora los flujos que miran la bandeja reaccionaban a algo
-- que ENTRABA (`on_inbound_after_inactivity` dispara cuando la clienta
-- escribe después de un hueco). Este mira lo contrario: el último mensaje del
-- chat es nuestro y pasaron N horas sin que ella conteste. Sirve para el
-- seguimiento de siempre — un presupuesto que quedó en visto, una seña que no
-- se pagó, un recordatorio que nadie respondió.
--
-- Como no lo dispara ningún webhook, lo barre el reloj del worker
-- (worker/whatsapp-cloud.ts), y el envío no sale en el momento en que se
-- detecta: se ENCOLA con hora de salida, porque un seguimiento automático a
-- las 4 de la mañana es peor que no mandarlo. Ver el punto 3.
--
--   1. `automation_trigger` aprende el valor `no_reply_after_outbound`.
--   2. `automation_executions.silence_anchor_at`: el ancla de la racha de
--      silencio, que es lo que impide mandar el mismo seguimiento dos veces.
--   3. Nada: la cola de espera sale de columnas que ya existían.
--
-- Requiere haber corrido antes `whatsapp-window-countdown.sql`
-- (`conversations.last_inbound_at` es el reloj del que sale el ancla).
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── el trigger nuevo ──────────────────────────────────────────────────
-- OJO: Postgres no deja usar un valor de enum recién agregado en la misma
-- transacción que lo agrega. Por eso este script NO escribe
-- 'no_reply_after_outbound' en ningún lado más: solo lo declara. Los flujos
-- se crean después, desde el panel.
alter type public.automation_trigger
  add value if not exists 'no_reply_after_outbound';

-- 2 ─── el ancla de la racha de silencio ──────────────────────────────────
-- El silencio no empieza cuando mandamos el último mensaje: empieza cuando
-- ella dejó de contestar. Por eso el ancla es `conversations.last_inbound_at`
-- —su último mensaje de verdad— y no `last_message_at`.
--
-- Es exactamente la diferencia entre "una vez por racha" y "una vez por
-- mensaje": si el ancla fuera nuestro último mensaje, el propio seguimiento
-- que mandamos pasaría a ser el último mensaje y al día siguiente dispararía
-- de nuevo, y otra vez, sobre un chat abandonado. Con el ancla en el entrante,
-- el flujo se rearma recién cuando la clienta vuelve a escribir.
--
-- Las conversaciones donde nunca escribió (las abre el CRM para poder mandar
-- una plantilla) no tienen entrante: ahí el worker ancla en el `created_at`
-- del chat, que también es fijo. Una sola racha, que es la verdad.
alter table public.automation_executions
  add column if not exists silence_anchor_at timestamptz;

comment on column public.automation_executions.silence_anchor_at is
  'Solo para flujos no_reply_after_outbound: arranque de la racha de silencio (conversations.last_inbound_at, o created_at del chat si nunca escribió). Es la clave que hace que el seguimiento salga una sola vez por racha.';

-- El único de verdad. Parcial a propósito: las ejecuciones de los flujos de
-- turno y de mensaje entrante dejan la columna en NULL y no tienen por qué
-- entrar en este índice —dos recordatorios distintos sobre el mismo chat son
-- perfectamente válidos—.
create unique index if not exists automation_executions_silence_racha_uidx
  on public.automation_executions (flow_id, conversation_id, silence_anchor_at)
  where silence_anchor_at is not null;

-- 3 ─── la cola de espera (sin columnas nuevas) ───────────────────────────
-- El horario no necesitó tabla propia: una ejecución en 'pending' con
-- `scheduled_for` en el futuro ES la cola. El worker detecta el silencio
-- cuando ocurre, escribe la fila con la hora en que se puede mandar —la
-- próxima franja de 9 a 21— y en cada vuelta manda lo que ya venció. A las 9
-- de la mañana eso vacía de una todo lo que se juntó durante la noche.
--
-- Que el mensaje se arme al vencer y no al detectar es lo que permite
-- cancelarlo: si la clienta contestó en el medio, la fila se cierra en
-- 'skipped' con el motivo y no sale nada encima de su respuesta.
--
-- La única excepción al horario es la ventana de 24 h de la Cloud API: un
-- flujo en modo texto libre que se quedaría sin ventana antes de la mañana
-- sale en el momento, porque esperar sería perder el mensaje.

-- 4 ─── el barrido del worker ─────────────────────────────────────────────
-- No todo silencio es una venta esperando respuesta, así que el worker
-- descarta dos casos antes de encolar nada, y los dos salen de datos que ya
-- están en la base:
--
--   · `messages.sent_by` — null es "lo mandó el sistema". Un recordatorio de
--     turno o una encuesta no esperan respuesta: solo se persigue lo que
--     escribió una persona.
--   · `appointments` — con turno agendado la venta ya se cerró, y con un turno
--     atendido en los últimos días el chat es post-servicio (el comprobante,
--     el "gracias"), no venta.
--
-- Cada vuelta busca conversaciones por `last_message_at` dentro de una
-- ventana. La bandeja ya ordena por esa columna, así que el índice casi seguro
-- existe con otro nombre; se crea solo si no hay ninguno que la cubra, para no
-- terminar con dos índices iguales.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'conversations'
       and indexdef like '%last_message_at%'
  ) then
    create index conversations_last_message_at_idx
      on public.conversations (last_message_at desc);
  end if;
end $$;

-- PostgREST tiene que enterarse de la columna y del valor nuevos.
notify pgrst, 'reload schema';
