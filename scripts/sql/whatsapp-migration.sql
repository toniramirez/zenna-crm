-- ─────────────────────────────────────────────────────────────────────────
-- Migración al número de la WhatsApp Cloud API como canal principal.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Contexto: el salón cambió de número. El viejo (Baileys, canal `whatsapp`)
-- queda conectado como archivo + redirección; el nuevo (Cloud API, canal
-- `whatsapp_cloud`) pasa a ser el canal principal y es de donde salen TODAS
-- las automatizaciones. Lo que hace esta migración:
--
--   1. `automation_flows` aprende a mandar plantillas aprobadas de Meta, no
--      solo texto libre. Es lo que hace posible el punto anterior: fuera de
--      la ventana de 24 h la Cloud API rechaza el texto libre, y un
--      recordatorio de turno casi siempre cae fuera de esa ventana.
--   2. `whatsapp_legacy_settings`: la respuesta automática de redirección con
--      la que contesta el número viejo.
--   3. `conversations.legacy_redirect_at`: cuándo se le avisó por última vez
--      a ese chat, para el cooldown configurable.
--
-- Requiere haber corrido antes `whatsapp-cloud-api.sql`.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── plantillas en las automatizaciones ────────────────────────────────

-- 'text'     → `message_body` tal cual (solo llega dentro de la ventana 24 h).
-- 'template' → plantilla aprobada del WABA; abre la ventana por sí sola.
-- El default es 'text' a propósito: los flujos que ya existen siguen
-- comportándose igual hasta que alguien los edite.
alter table public.automation_flows
  add column if not exists send_mode text not null default 'text';

alter table public.automation_flows
  drop constraint if exists automation_flows_send_mode_check;
alter table public.automation_flows
  add constraint automation_flows_send_mode_check
  check (send_mode in ('text', 'template'));

-- Identidad operativa de la plantilla en Meta: (name, language). Es lo que
-- viaja en el payload de envío y lo que indexa `whatsapp_templates`. No se
-- guarda el uuid de la fila cacheada a propósito: esa caché se pisa entera en
-- cada sincronización y un FK contra ella se rompería solo.
alter table public.automation_flows
  add column if not exists template_name text;

alter table public.automation_flows
  add column if not exists template_language text;

-- Con qué se rellena cada placeholder de la plantilla. Forma:
--   {"header": {"1": "{{nombre}}"}, "body": {"1": "{{nombre}}", "2": "{{fecha}}"}}
-- Los valores son mini-plantillas del CRM: se pasan por `renderTemplate` con
-- el contexto del turno (nombre, servicio, fecha, hora, profesional, salon)
-- justo antes de encolar, así que también aceptan texto fijo.
alter table public.automation_flows
  add column if not exists template_params jsonb not null
  default '{"header": {}, "body": {}}'::jsonb;

comment on column public.automation_flows.send_mode is
  'text = message_body libre (solo dentro de la ventana de 24 h). template = plantilla aprobada del WABA, que reabre la conversación.';
comment on column public.automation_flows.template_params is
  'Valores de los placeholders de la plantilla, como mini-plantillas {{var}} del CRM. {"header": {...}, "body": {...}}';

-- Un flujo en modo plantilla sin plantilla elegida no se puede disparar: se
-- corta acá y no en el worker, donde el error aparecería recién al fallar el
-- primer turno.
alter table public.automation_flows
  drop constraint if exists automation_flows_template_required;
alter table public.automation_flows
  add constraint automation_flows_template_required
  check (
    send_mode <> 'template'
    or (template_name is not null and template_language is not null)
  );

-- 2 ─── respuesta automática del número viejo ─────────────────────────────
create table if not exists public.whatsapp_legacy_settings (
  -- Misma clave que `whatsapp_status`: una fila por sesión de Baileys.
  session_id        text primary key default 'default',

  -- Con esto en false el número viejo no contesta nada: queda como archivo
  -- de solo lectura del lado de la clienta.
  redirect_enabled  boolean not null default false,

  -- El texto del aviso. Acepta {{numero}}, que se reemplaza por
  -- `redirect_number` al mandar.
  redirect_message  text not null default
    '¡Hola! 👋 Este número ya no está en uso. Escribinos al {{numero}} así te respondemos. ¡Gracias! 💛',

  -- El número nuevo, como se lo quiere ver escrito en el mensaje.
  redirect_number   text,

  -- 0 = contestar cada vez que escriban. >0 = no repetir el aviso en ese
  -- chat hasta que pasen esos minutos (ver conversations.legacy_redirect_at).
  redirect_cooldown_minutes integer not null default 0
    check (redirect_cooldown_minutes >= 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.whatsapp_legacy_settings is
  'Respuesta automática de redirección del número viejo (Baileys) al número de la Cloud API.';

create or replace function public.whatsapp_legacy_settings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_legacy_settings_touch
  on public.whatsapp_legacy_settings;
create trigger whatsapp_legacy_settings_touch
  before update on public.whatsapp_legacy_settings
  for each row execute function public.whatsapp_legacy_settings_touch_updated_at();

-- RLS: no hay nada sensible acá (es un texto que se le manda a cualquiera que
-- escriba), así que el staff lo lee y lo edita desde Configuración. Mismo
-- criterio que `whatsapp_status`, que también se toca desde el panel.
alter table public.whatsapp_legacy_settings enable row level security;

drop policy if exists whatsapp_legacy_settings_read
  on public.whatsapp_legacy_settings;
create policy whatsapp_legacy_settings_read
  on public.whatsapp_legacy_settings for select
  to authenticated
  using (true);

drop policy if exists whatsapp_legacy_settings_write
  on public.whatsapp_legacy_settings;
create policy whatsapp_legacy_settings_write
  on public.whatsapp_legacy_settings for update
  to authenticated
  using (true)
  with check (true);

insert into public.whatsapp_legacy_settings (session_id)
values ('default')
on conflict (session_id) do nothing;

-- 3 ─── cooldown por chat ─────────────────────────────────────────────────
-- Cuándo se le mandó el aviso de redirección por última vez a este chat.
-- Solo lo escribe el worker de Baileys, y solo en conversaciones del canal
-- `whatsapp`.
alter table public.conversations
  add column if not exists legacy_redirect_at timestamptz;

comment on column public.conversations.legacy_redirect_at is
  'Última vez que el número viejo contestó el aviso de redirección en este chat. NULL = nunca.';

-- La bandeja principal filtra por canal en cada carga; sin esto es un scan de
-- toda la tabla para armar cada una de las dos listas.
create index if not exists conversations_channel_last_message_idx
  on public.conversations (channel, last_message_at desc nulls last)
  where archived = false;

-- PostgREST tiene que enterarse de las columnas/tablas nuevas.
notify pgrst, 'reload schema';
