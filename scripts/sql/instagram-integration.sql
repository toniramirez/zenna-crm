-- ─────────────────────────────────────────────────────────────────────────
-- Integración Instagram (Meta) — DMs en la bandeja del CRM
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Lo que hace:
--   1. Permite channel='instagram' en `conversations`.
--   2. Garantiza unicidad por (channel, external_id) — clave para el upsert
--      del webhook, que identifica la conversación por el IGSID.
--   3. Crea `instagram_accounts`, donde vive el token de acceso.
--      RLS: nadie del lado del cliente puede leerla. Solo service_role.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── channel: aceptar 'instagram' ──────────────────────────────────────
-- `channel` es text con default 'whatsapp'. Si hay un CHECK viejo que solo
-- permitía 'whatsapp', lo reemplazamos.
alter table public.conversations
  drop constraint if exists conversations_channel_check;

alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram'));

-- 2 ─── unicidad por canal + id externo ───────────────────────────────────
-- El webhook hace get-or-create por (channel, external_id). Sin este índice
-- dos eventos simultáneos de la misma persona crean conversaciones duplicadas.
create unique index if not exists conversations_channel_external_id_key
  on public.conversations (channel, external_id);

-- Dedup de mensajes entrantes: Meta reintenta la entrega del webhook si no
-- respondemos 200 a tiempo, y reenvía el mismo `mid`. Con el índice, ese
-- reintento choca con un 23505 que el código ignora como duplicado.
--
-- Va sobre (conversation_id, external_id) y NO sobre external_id solo: un id
-- de mensaje de WhatsApp es único dentro de un chat, no globalmente, y el
-- histórico ya tiene ids repetidos entre conversaciones distintas.
--
-- Envuelto en un bloque con excepción a propósito: si el histórico de WhatsApp
-- llegara a tener duplicados incluso dentro de una misma conversación, el
-- índice no se crea y la migración sigue igual en vez de abortar entera. El
-- dedup no depende de esto para funcionar — `ingest.ts` chequea antes de
-- insertar. El índice es la red de seguridad contra carreras, no el mecanismo.
do $$
begin
  create unique index if not exists messages_conv_external_id_key
    on public.messages (conversation_id, external_id)
    where external_id is not null;
exception when others then
  raise notice 'Índice de dedup omitido (ya hay external_id duplicados en el histórico). El dedup por código sigue activo.';
end $$;

-- 3 ─── cuenta de Instagram conectada ─────────────────────────────────────
create table if not exists public.instagram_accounts (
  -- Una sola fila en la práctica (un salón, una cuenta). `account_id` la
  -- deja preparada para multi-cuenta sin migrar de nuevo.
  account_id      text primary key default 'default',

  -- IG-ID de la cuenta profesional: el `<IG_ID>` de POST /<IG_ID>/messages.
  ig_user_id      text,
  username        text,

  -- Token de usuario de Instagram, de larga duración (60 días).
  -- NUNCA se expone al browser: la tabla es service_role-only y el panel de
  -- configuración solo recibe los campos no sensibles.
  access_token    text,
  token_expires_at timestamptz,

  -- Para soportar las dos variantes de la API sin tocar código:
  --   'instagram' → https://graph.instagram.com  (Instagram Login)
  --   'facebook'  → https://graph.facebook.com   (Facebook Login, via Página)
  login_type      text not null default 'instagram'
                  check (login_type in ('instagram', 'facebook')),

  state           text not null default 'disconnected'
                  check (state in ('disconnected', 'connected', 'error')),
  last_error      text,
  last_connected_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.instagram_accounts is
  'Credenciales de la cuenta de Instagram conectada. Contiene un token de acceso: acceso solo con service_role.';

-- updated_at automático. Reusamos el trigger del resto del esquema si existe;
-- si no, definimos uno local.
create or replace function public.instagram_accounts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists instagram_accounts_touch on public.instagram_accounts;
create trigger instagram_accounts_touch
  before update on public.instagram_accounts
  for each row execute function public.instagram_accounts_touch_updated_at();

-- 4 ─── RLS: bloqueo total del lado del cliente ───────────────────────────
-- Sin políticas + RLS habilitado = nadie con la publishable key puede leer
-- ni escribir. service_role hace bypass de RLS, así que el webhook, el worker
-- y las server actions (que usan la service key) siguen funcionando.
alter table public.instagram_accounts enable row level security;

-- Defensa en profundidad: aunque alguien agregue una política por error,
-- los roles del cliente no tienen el GRANT.
revoke all on public.instagram_accounts from anon, authenticated;

-- 5 ─── fila inicial ──────────────────────────────────────────────────────
insert into public.instagram_accounts (account_id)
values ('default')
on conflict (account_id) do nothing;
