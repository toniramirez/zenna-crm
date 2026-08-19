-- ─────────────────────────────────────────────────────────────────────────
-- Integración WhatsApp Cloud API (oficial de Meta) — canal `whatsapp_cloud`
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Convive con el canal `whatsapp` (Baileys): son dos números distintos que
-- comparten bandeja. Lo que hace:
--   1. Permite channel='whatsapp_cloud' en `conversations`.
--   2. Crea `whatsapp_cloud_accounts`, donde viven las credenciales de la
--      Cloud API (token, phone_number_id, WABA). Solo service_role.
--   3. Crea `whatsapp_templates`, el caché local de las plantillas aprobadas
--      en el WhatsApp Manager. Lectura para staff, escritura service_role.
--   4. Agrega `messages.wa_template`: el payload de plantilla que el worker
--      manda tal cual a Meta cuando la fila encolada es una plantilla.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── channel: aceptar 'whatsapp_cloud' ─────────────────────────────────
-- OJO: instagram-integration.sql recrea este mismo constraint. Las dos
-- migraciones quedaron con la lista completa de canales para que correr
-- cualquiera de las dos (en cualquier orden, las veces que sea) converja al
-- mismo estado y ninguna le borre un canal a la otra.
alter table public.conversations
  drop constraint if exists conversations_channel_check;

alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram', 'whatsapp_cloud'));

-- Unicidad por canal + id externo, e índice de dedup de mensajes. Los crea
-- también instagram-integration.sql, pero esta migración no puede depender de
-- que aquella haya corrido: el get-or-create del webhook resuelve las carreras
-- releyendo tras un 23505, y el dedup de reintentos de Meta usa el segundo
-- índice como red de seguridad (ver lib/whatsapp-cloud/ingest.ts).
create unique index if not exists conversations_channel_external_id_key
  on public.conversations (channel, external_id);

-- Envuelto en un bloque con excepción a propósito: si el histórico de WhatsApp
-- tuviera external_id duplicados dentro de una misma conversación, el índice
-- no se crea y la migración sigue igual — el dedup por código no depende de él.
do $$
begin
  create unique index if not exists messages_conv_external_id_key
    on public.messages (conversation_id, external_id)
    where external_id is not null;
exception when others then
  raise notice 'Índice de dedup omitido (ya hay external_id duplicados en el histórico). El dedup por código sigue activo.';
end $$;

-- 2 ─── credenciales de la Cloud API ──────────────────────────────────────
create table if not exists public.whatsapp_cloud_accounts (
  -- Una sola fila en la práctica (un salón, un número). `account_id` la deja
  -- preparada para multi-número sin migrar de nuevo, igual que en Instagram.
  account_id            text primary key default 'default',

  -- Token de acceso. Con un System User de Meta Business puede ser permanente,
  -- que es lo recomendado: no vence ni hay que renovarlo.
  -- NUNCA se expone al browser: la tabla es service_role-only y el panel de
  -- configuración solo recibe los campos no sensibles.
  access_token          text,

  -- `<PHONE_NUMBER_ID>` de POST /<PHONE_NUMBER_ID>/messages. No es el número
  -- de teléfono: es el id que muestra el App Dashboard en WhatsApp → API Setup.
  phone_number_id       text,

  -- WhatsApp Business Account ID: de acá se listan las plantillas
  -- (GET /<WABA_ID>/message_templates).
  waba_id               text,

  -- Datos informativos que devuelve Meta al validar la conexión.
  display_phone_number  text,
  verified_name         text,
  quality_rating        text,

  state                 text not null default 'disconnected'
                        check (state in ('disconnected', 'connected', 'error')),
  last_error            text,
  last_connected_at     timestamptz,
  templates_synced_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.whatsapp_cloud_accounts is
  'Credenciales de la WhatsApp Cloud API (oficial). Contiene un token de acceso: acceso solo con service_role.';

create or replace function public.whatsapp_cloud_accounts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_cloud_accounts_touch on public.whatsapp_cloud_accounts;
create trigger whatsapp_cloud_accounts_touch
  before update on public.whatsapp_cloud_accounts
  for each row execute function public.whatsapp_cloud_accounts_touch_updated_at();

-- RLS: bloqueo total del lado del cliente, igual que `instagram_accounts`.
alter table public.whatsapp_cloud_accounts enable row level security;
revoke all on public.whatsapp_cloud_accounts from anon, authenticated;

insert into public.whatsapp_cloud_accounts (account_id)
values ('default')
on conflict (account_id) do nothing;

-- 3 ─── caché de plantillas aprobadas ─────────────────────────────────────
-- Las plantillas se crean y aprueban en el WhatsApp Manager de Meta; acá solo
-- se cachean para que el selector del chat las liste sin pegarle a la API en
-- cada apertura. Se sincronizan desde Configuración (y al conectar).
create table if not exists public.whatsapp_templates (
  id          uuid primary key default gen_random_uuid(),

  -- Id de la plantilla en Meta. Informativo: la identidad operativa es
  -- (name, language), que es lo que se manda en el payload de envío.
  meta_id     text,

  name        text not null,
  language    text not null,
  category    text,

  -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED (lo que diga Meta).
  -- Solo las APPROVED se pueden enviar.
  status      text not null default 'PENDING',

  -- El array `components` tal cual lo devuelve la API (HEADER/BODY/FOOTER/
  -- BUTTONS con sus textos y placeholders). El selector del chat lo parsea
  -- para pedir las variables y armar la vista previa.
  components  jsonb not null default '[]'::jsonb,

  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists whatsapp_templates_name_language_key
  on public.whatsapp_templates (name, language);

comment on table public.whatsapp_templates is
  'Caché local de las plantillas del WABA. La fuente de verdad es el WhatsApp Manager; esto se pisa en cada sincronización.';

create or replace function public.whatsapp_templates_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_templates_touch on public.whatsapp_templates;
create trigger whatsapp_templates_touch
  before update on public.whatsapp_templates
  for each row execute function public.whatsapp_templates_touch_updated_at();

-- RLS: el staff las lee desde la bandeja (no hay nada sensible: son los
-- textos que ya están publicados en el WhatsApp Manager). Escribe solo el
-- servidor con service_role, que hace bypass de RLS.
alter table public.whatsapp_templates enable row level security;

drop policy if exists whatsapp_templates_read on public.whatsapp_templates;
create policy whatsapp_templates_read
  on public.whatsapp_templates for select
  to authenticated
  using (true);

-- 4 ─── payload de plantilla en la cola de salida ─────────────────────────
-- Cuando una fila encolada trae `wa_template`, el worker de la Cloud API la
-- manda como plantilla (type='template' con este payload) en vez de texto
-- libre. `body` guarda la vista previa ya renderizada para la bandeja.
alter table public.messages
  add column if not exists wa_template jsonb;

comment on column public.messages.wa_template is
  'Payload de plantilla de la Cloud API ({name, language, components}). Solo en salientes del canal whatsapp_cloud.';

-- PostgREST tiene que enterarse de las columnas/tablas nuevas.
notify pgrst, 'reload schema';
