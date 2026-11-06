-- ─────────────────────────────────────────────────────────────────────────
-- Difusiones: un mismo mensaje a un segmento de clientas
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Una difusión es un mensaje (texto libre o plantilla aprobada de Meta) más
-- un segmento definido por filtros —etiquetas, última visita, servicios que se
-- hizo, profesional, cumpleaños…—. Se arma desde CRM → Configuración →
-- Difusiones y la manda el worker de la Cloud API (worker/broadcasts.ts).
--
--   1. `broadcasts`: la difusión en sí. Guarda los filtros, no la lista de
--      destinatarias: el segmento se calcula recién cuando arranca el envío,
--      así una difusión programada para el viernes incluye a la clienta que
--      se etiquetó el jueves.
--   2. `broadcast_recipients`: la foto del segmento al arrancar, una fila por
--      clienta, con el mensaje que se le encoló. Es la cola de la difusión y
--      también su historial.
--   3. `broadcast_stats`: la vista con los números de cada difusión
--      (entregados, leídos, respondieron…), que salen de cruzar la cola con
--      los acuses de `messages`.
--
-- Requiere `whatsapp-cloud-api.sql` (messages.wa_template) y
-- `whatsapp-window-countdown.sql` (conversations.last_inbound_at).
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── broadcasts ────────────────────────────────────────────────────────
-- Ciclo de vida:
--   draft      → se está armando; no sale nada.
--   scheduled  → tiene hora (`scheduled_for`). "Enviar ahora" es programar
--                para ya: un solo camino hasta el worker.
--   sending    → el worker calculó el segmento y está vaciando la cola.
--   completed  → no quedan destinatarias pendientes.
--   cancelled  → se frenó a mano; lo que no había salido no sale.
--
-- Los campos del mensaje se llaman igual que en `automation_flows` a
-- propósito: el worker los pasa por el mismo `buildFlowMessage`, así una
-- plantilla se valida y se arma exactamente igual en un recordatorio de turno
-- que en una difusión.
create table if not exists public.broadcasts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  status            text not null default 'draft',

  -- { match: 'all'|'any', conditions: [...], excludeTags: [...],
  --   excludeRecentDays: n|null }. La forma la define y la valida
  -- lib/broadcasts/filters.ts; la base solo la guarda.
  filters           jsonb not null default
    '{"match":"all","conditions":[],"excludeTags":[],"excludeRecentDays":null}'::jsonb,

  send_mode         text not null default 'template',
  message_body      text not null default '',
  template_name     text,
  template_language text,
  template_params   jsonb not null default '{"header":{},"body":{}}'::jsonb,

  scheduled_for     timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,

  -- Cuántas quedaron en la foto del segmento. NULL hasta que el worker la
  -- saca: es también la marca de "ya se calculó", por si el worker se
  -- reinicia justo entre reclamar la difusión y escribir la cola.
  audience_size     integer,
  last_error        text,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.broadcasts
  drop constraint if exists broadcasts_status_check;
alter table public.broadcasts
  add constraint broadcasts_status_check
  check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled'));

alter table public.broadcasts
  drop constraint if exists broadcasts_send_mode_check;
alter table public.broadcasts
  add constraint broadcasts_send_mode_check
  check (send_mode in ('text', 'template'));

alter table public.broadcasts
  drop constraint if exists broadcasts_name_check;
alter table public.broadcasts
  add constraint broadcasts_name_check
  check (char_length(btrim(name)) between 1 and 120);

-- Mismo criterio que en automation_flows: en modo plantilla tiene que haber
-- una elegida, y una difusión programada tiene que tener hora.
alter table public.broadcasts
  drop constraint if exists broadcasts_template_check;
alter table public.broadcasts
  add constraint broadcasts_template_check
  check (
    send_mode <> 'template'
    or (template_name is not null and template_language is not null)
  );

alter table public.broadcasts
  drop constraint if exists broadcasts_scheduled_check;
alter table public.broadcasts
  add constraint broadcasts_scheduled_check
  check (status <> 'scheduled' or scheduled_for is not null);

comment on table public.broadcasts is
  'Difusiones: un mensaje a un segmento de clientas definido por filtros. La arma CRM → Configuración → Difusiones; la manda worker/broadcasts.ts.';
comment on column public.broadcasts.filters is
  'Segmento: { match, conditions, excludeTags, excludeRecentDays }. Ver lib/broadcasts/filters.ts.';
comment on column public.broadcasts.audience_size is
  'Destinatarias en la foto del segmento. NULL mientras el worker no la calculó.';

-- El worker entra siempre por acá: lo programado que ya venció y lo que está
-- saliendo. Las terminadas (la gran mayoría con el tiempo) quedan afuera.
create index if not exists broadcasts_active_idx
  on public.broadcasts (scheduled_for)
  where status in ('scheduled', 'sending');

create index if not exists broadcasts_created_idx
  on public.broadcasts (created_at desc);

create or replace function public.broadcasts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists broadcasts_touch_updated_at on public.broadcasts;
create trigger broadcasts_touch_updated_at
  before update on public.broadcasts
  for each row execute function public.broadcasts_touch_updated_at();

-- 2 ─── broadcast_recipients ──────────────────────────────────────────────
-- La foto del segmento. El nombre y el teléfono se copian (además del
-- client_id) porque son lo que se mandó: si mañana se borra la ficha o se
-- corrige el número, el historial tiene que seguir diciendo a quién salió.
--
--   pending    → en la cola de la difusión.
--   processing → el worker la tomó; se está abriendo el chat y encolando.
--   queued     → el mensaje quedó en `messages`. De acá en más el estado
--                real (enviado, entregado, leído, fallido) es el del mensaje.
--   skipped    → no se le mandó, con el motivo en `error` (sin ventana de
--                24 h en modo texto, difusión cancelada…).
--   failed     → no se pudo encolar.
create table if not exists public.broadcast_recipients (
  id                uuid primary key default gen_random_uuid(),
  broadcast_id      uuid not null references public.broadcasts(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  full_name         text not null,
  phone             text not null,
  status            text not null default 'pending',
  conversation_id   uuid references public.conversations(id) on delete set null,
  message_id        uuid references public.messages(id) on delete set null,
  error             text,
  processed_at      timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.broadcast_recipients
  drop constraint if exists broadcast_recipients_status_check;
alter table public.broadcast_recipients
  add constraint broadcast_recipients_status_check
  check (status in ('pending', 'processing', 'queued', 'skipped', 'failed'));

-- Una clienta, una vez por difusión. Es lo que hace que recalcular el
-- segmento después de un reinicio del worker no duplique a nadie.
create unique index if not exists broadcast_recipients_client_uidx
  on public.broadcast_recipients (broadcast_id, client_id);

create index if not exists broadcast_recipients_queue_idx
  on public.broadcast_recipients (broadcast_id, status, created_at);

-- El filtro "excluir a quien recibió una difusión en los últimos N días".
create index if not exists broadcast_recipients_recent_idx
  on public.broadcast_recipients (client_id, processed_at desc)
  where status = 'queued';

comment on table public.broadcast_recipients is
  'Destinatarias de cada difusión: la foto del segmento al arrancar el envío, con el mensaje encolado a cada una. La escribe worker/broadcasts.ts.';

-- 3 ─── broadcast_stats ───────────────────────────────────────────────────
-- Las categorías son excluyentes: cada destinataria cae en una sola, así las
-- barras de la tarjeta suman el total. `replied` es aparte (se superpone con
-- delivered/read): la clienta escribió al chat después de que le salió la
-- difusión.
--
-- `security_invoker` hace que la vista respete el RLS de quien la consulta
-- en vez del de su dueño.
create or replace view public.broadcast_stats
with (security_invoker = true)
as
select
  r.broadcast_id,
  count(*)::int as total,
  count(*) filter (where r.status in ('pending', 'processing'))::int as pending,
  count(*) filter (where r.status = 'skipped')::int as skipped,
  count(*) filter (
    where r.status = 'failed'
       or (r.status = 'queued' and m.status = 'failed')
  )::int as failed,
  count(*) filter (
    where r.status = 'queued' and m.status in ('queued', 'sending')
  )::int as in_queue,
  count(*) filter (where r.status = 'queued' and m.status = 'sent')::int as sent,
  count(*) filter (where r.status = 'queued' and m.status = 'delivered')::int as delivered,
  count(*) filter (where r.status = 'queued' and m.status = 'read')::int as read,
  count(*) filter (
    where r.status = 'queued'
      and m.status <> 'failed'
      and c.last_inbound_at > r.processed_at
  )::int as replied
from public.broadcast_recipients r
left join public.messages m on m.id = r.message_id
left join public.conversations c on c.id = r.conversation_id
group by r.broadcast_id;

comment on view public.broadcast_stats is
  'Números de cada difusión: categorías excluyentes (pending, skipped, failed, in_queue, sent, delivered, read) más replied.';

-- 4 ─── RLS ───────────────────────────────────────────────────────────────
-- El worker escribe con service_role (bypassea RLS). El personal ve todo; la
-- dueña es la única que arma, programa o cancela, igual que el resto de la
-- configuración del CRM.
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

drop policy if exists broadcasts_select_staff on public.broadcasts;
create policy broadcasts_select_staff
  on public.broadcasts for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

drop policy if exists broadcasts_write_owner on public.broadcasts;
create policy broadcasts_write_owner
  on public.broadcasts for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role = 'owner'
    )
  );

drop policy if exists broadcast_recipients_select_staff on public.broadcast_recipients;
create policy broadcast_recipients_select_staff
  on public.broadcast_recipients for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- Cancelar una difusión cierra desde el panel las filas que no llegaron a
-- salir, así que la dueña necesita poder actualizarlas. Insertar no: la cola
-- la escribe solo el worker.
drop policy if exists broadcast_recipients_update_owner on public.broadcast_recipients;
create policy broadcast_recipients_update_owner
  on public.broadcast_recipients for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role = 'owner'
    )
  );

grant select on public.broadcast_stats to authenticated;
