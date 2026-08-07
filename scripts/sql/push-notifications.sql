-- ─────────────────────────────────────────────────────────────────────────
-- Notificaciones push (Web Push / PWA)
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Guarda una fila por dispositivo suscripto. Un mismo usuario puede tener
-- varias (el iPhone, la tablet del salón, la compu): a todas se les manda.
--
-- El `endpoint` es la URL que da el navegador (Apple/Google/Mozilla) para
-- despertar ese dispositivo, y es único por instalación: sirve de clave.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),

  -- Dueño de la suscripción. Si se borra el usuario, se van sus dispositivos.
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- Datos que devuelve `PushManager.subscribe()`.
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,

  -- Para poder distinguir dispositivos en la UI ("iPhone de Toni").
  user_agent  text,
  label       text,

  created_at  timestamptz not null default now(),
  -- Último push entregado con éxito. Sirve para detectar dispositivos muertos.
  last_sent_at timestamptz
);

-- Un endpoint = un dispositivo. Si el navegador renueva la suscripción y
-- vuelve a mandar el mismo endpoint, se actualiza en vez de duplicar.
create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada quien administra sus propios dispositivos. El envío corre con
-- service_role (worker de WhatsApp y webhook de Instagram), que hace bypass
-- de RLS y no necesita política.
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);
