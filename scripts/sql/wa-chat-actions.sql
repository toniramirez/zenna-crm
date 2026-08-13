-- ─────────────────────────────────────────────────────────────────────────
-- Bandeja: reenviar / editar / cancelar envío + chats fijados
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Lo que agrega:
--   1. `conversations.pinned_at` — chats fijados arriba de la lista.
--   2. `messages.edited_at` / `revoked_at` / `forwarded` — el estado que
--      WhatsApp muestra en la burbuja ("editado", "se eliminó este mensaje",
--      "reenviado").
--   3. `message_ops` — la cola de operaciones sobre un mensaje YA enviado
--      (editar / eliminar para todos). El worker la consume igual que la cola
--      de salientes.
--   4. Política de UPDATE sobre `messages` para el personal: la bandeja marca
--      el mensaje como editado o eliminado desde el navegador, sin esperar al
--      worker. Sin esto, cancelar un envío con WhatsApp desconectado —que es
--      justo cuando hace falta— no haría nada.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── chats fijados ─────────────────────────────────────────────────────
-- Nullable a propósito: NULL = no fijado. Guardamos el instante y no un
-- booleano porque WhatsApp ordena los fijados entre sí por cuándo se fijaron.
alter table public.conversations
  add column if not exists pinned_at timestamptz;

comment on column public.conversations.pinned_at is
  'Cuándo se fijó el chat. NULL = no fijado. Los fijados van arriba de todo, ordenados por este campo.';

-- 2 ─── estado de la burbuja ──────────────────────────────────────────────
alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists forwarded boolean not null default false;

comment on column public.messages.edited_at is
  'Última vez que se editó el texto. Pinta el "editado" al lado de la hora.';

comment on column public.messages.revoked_at is
  'Eliminado para todos (o envío cancelado antes de salir). La burbuja pasa a "Se eliminó este mensaje" y el poller del worker ya no lo manda.';

comment on column public.messages.forwarded is
  'Se mandó reenviando otro mensaje. Pinta el "Reenviado" arriba de la burbuja.';

-- 3 ─── cola de operaciones ───────────────────────────────────────────────
-- Va en su propia tabla y NO como un renglón más de `messages` con type
-- 'edit'/'revoke' por dos motivos:
--   - el trigger que mantiene `last_message_at` / `last_message_preview` se
--     dispara con cada insert en `messages`: una edición dejaría la vista
--     previa del chat en cualquier cosa;
--   - el worker de Instagram levanta TODO lo que esté 'queued' en su canal y
--     no sabría qué hacer con una operación de WhatsApp.
--
-- `message_id` y no `external_id`: el id de WhatsApp es único dentro de un
-- chat, no globalmente (el histórico ya tiene repetidos entre conversaciones).
create table if not exists public.message_ops (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  op text not null check (op in ('edit', 'revoke')),
  -- Texto nuevo cuando op='edit'. NULL en 'revoke'.
  body text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'done', 'failed')),
  error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.message_ops is
  'Cola de operaciones sobre mensajes ya enviados (editar / eliminar para todos). La consume worker/baileys.ts.';

-- Índice parcial: el poller pregunta siempre por lo pendiente, y en una cola
-- sana eso es un puñado de filas contra un histórico que sólo crece.
create index if not exists message_ops_queued_idx
  on public.message_ops (created_at)
  where status = 'queued';

create index if not exists message_ops_message_id_idx
  on public.message_ops (message_id);

alter table public.message_ops enable row level security;

-- El personal encola operaciones desde la bandeja; el worker las procesa con
-- service_role, que hace bypass de RLS y no necesita política.
drop policy if exists message_ops_select_staff on public.message_ops;
create policy message_ops_select_staff
  on public.message_ops for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

drop policy if exists message_ops_insert_staff on public.message_ops;
create policy message_ops_insert_staff
  on public.message_ops for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- 4 ─── el personal puede editar/eliminar sus mensajes ────────────────────
-- Es aditiva: si ya existe otra política de UPDATE sobre `messages`, las
-- permisivas se suman (OR), no se pisan.
drop policy if exists messages_update_staff on public.messages;
create policy messages_update_staff
  on public.messages for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- 5 ─── el personal puede abrir una conversación nueva ────────────────────
-- Hasta ahora las conversaciones sólo nacían de un mensaje entrante, así que
-- las creaba el worker con service_role. Desde el turnero se puede escribirle
-- primero a una clienta que nunca escribió, y ese INSERT sale con la sesión
-- de quien está usando el sistema.
drop policy if exists conversations_insert_staff on public.conversations;
create policy conversations_insert_staff
  on public.conversations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- 6 ─── refrescar el cache de esquema de PostgREST ────────────────────────
-- Supabase suele recargarlo solo tras un DDL, pero forzarlo evita quedar un
-- rato con `column messages.revoked_at does not exist` mientras el cache
-- viejo sigue vivo.
notify pgrst, 'reload schema';
