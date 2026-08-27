-- ─────────────────────────────────────────────────────────────────────────
-- El contador de la ventana de 24 h, también en la lista de chats.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Hasta ahora el contador vivía solo dentro del chat abierto: se calculaba
-- en el cliente recorriendo los mensajes cargados. Para pintarlo en cada fila
-- de la bandeja haría falta el historial de las 100 conversaciones, así que
-- el dato pasa a la tabla: `conversations.last_inbound_at`, mantenido por un
-- trigger, y la lista lo lee en el mismo `select *` que ya hace.
--
-- Requiere haber corrido antes `whatsapp-cloud-api.sql`.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── la columna ────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists last_inbound_at timestamptz;

comment on column public.conversations.last_inbound_at is
  'Último mensaje entrante real de la clienta (las reacciones no cuentan). Es el reloj de la ventana de 24 h de la Cloud API: cierra a last_inbound_at + 24 h. NULL = nunca escribió.';

-- 2 ─── el trigger ────────────────────────────────────────────────────────
-- Va aparte del trigger que mantiene `last_message_at` / `last_message_preview`
-- —no lo toca— porque mira otra cosa: aquél sigue al último mensaje sea de
-- quien sea, y éste solo a los entrantes.
--
-- Las reacciones quedan afuera a propósito: para Meta la ventana la abre un
-- mensaje de verdad, no un emoji sobre uno nuestro. Es la misma regla que ya
-- aplican el worker antes de mandar y la bandeja al mostrar el contador.
--
-- El `where` de la condición hace que un insert viejo (una importación, un
-- webhook que llega tarde) no pueda retrasar el reloj: la fecha solo avanza.
create or replace function public.conversations_touch_last_inbound()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
     set last_inbound_at = new.sent_at
   where id = new.conversation_id
     and (last_inbound_at is null or last_inbound_at < new.sent_at);
  return null;
end;
$$;

drop trigger if exists conversations_touch_last_inbound on public.messages;
create trigger conversations_touch_last_inbound
  after insert on public.messages
  for each row
  when (new.direction = 'inbound' and new.type <> 'reaction')
  execute function public.conversations_touch_last_inbound();

-- 3 ─── relleno de lo que ya existe ───────────────────────────────────────
-- Sin esto la bandeja arrancaría con todas las ventanas cerradas hasta que
-- cada clienta vuelva a escribir. Solo pisa las filas que todavía no tienen
-- el dato, así que volver a correr el script no deshace nada.
update public.conversations c
   set last_inbound_at = m.max_sent_at
  from (
    select conversation_id, max(sent_at) as max_sent_at
      from public.messages
     where direction = 'inbound'
       and type <> 'reaction'
     group by conversation_id
  ) m
 where m.conversation_id = c.id
   and c.last_inbound_at is null;

-- PostgREST tiene que enterarse de la columna nueva.
notify pgrst, 'reload schema';
