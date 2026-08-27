-- ─────────────────────────────────────────────────────────────────────────
-- Respuestas automáticas a los botones de una plantilla.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Contexto: un flujo en modo plantilla puede mandar una plantilla con botones
-- de respuesta rápida ("Confirmar", "Reprogramar"…). Hasta ahora el click
-- llegaba a la bandeja como un mensaje de texto más y lo contestaba una
-- persona. Con esto el flujo puede traer la respuesta ya escrita.
--
-- La respuesta NO es otra plantilla: el click de la clienta abre la ventana
-- de 24 h de la Cloud API, así que a partir de ahí se puede mandar cualquier
-- cosa — texto libre, una imagen, un video. Es justamente lo que una
-- plantilla no deja hacer.
--
--   1. `automation_flows.button_replies`: qué contesta el flujo por botón.
--   2. `automation_button_events`: el registro de cada click contestado, que
--      además es lo que impide contestar dos veces el mismo click.
--
-- Requiere haber corrido antes `whatsapp-migration.sql`.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── qué contesta el flujo por botón ───────────────────────────────────

-- Forma:
--   [
--     {
--       "button": "Confirmar",              -- texto exacto del botón
--       "body": "¡Genial {{nombre}}! Te esperamos 💛",
--       "media_type": "image",              -- null | "image" | "video"
--       "media_url": "outbound/automations/<uuid>.jpg",
--       "media_mime": "image/jpeg",
--       "media_filename": "como-llegar.jpg"
--     }
--   ]
--
-- `body` es una mini-plantilla del CRM: se pasa por `renderTemplate` con el
-- nombre de la clienta antes de encolar, igual que `message_body`. Cuando hay
-- media, el body viaja como epígrafe del archivo (un solo mensaje, no dos).
--
-- Va como jsonb y no como tabla aparte por el mismo motivo que
-- `template_params`: es una lista corta que se edita entera junto con el
-- flujo, y una tabla obligaría a un CRUD propio para nada.
alter table public.automation_flows
  add column if not exists button_replies jsonb not null default '[]'::jsonb;

comment on column public.automation_flows.button_replies is
  'Respuestas automáticas a los botones de respuesta rápida de la plantilla del flujo. Array de {button, body, media_type, media_url, media_mime, media_filename}.';

-- Tiene que ser un array: el parser del worker igual se defiende, pero un
-- objeto suelto acá sería un error de escritura que conviene que salte ya.
alter table public.automation_flows
  drop constraint if exists automation_flows_button_replies_is_array;
alter table public.automation_flows
  add constraint automation_flows_button_replies_is_array
  check (jsonb_typeof(button_replies) = 'array');

-- 2 ─── registro de los clicks contestados ────────────────────────────────
-- Una fila por click de botón que el CRM contestó solo.
--
-- El único sobre `inbound_message_id` es el que hace que el mismo click no se
-- conteste dos veces: `messages.external_id` ya es único por wamid, así que
-- un webhook repetido de Meta ni siquiera llega hasta acá, pero un reintento
-- del hook de entrada sí llegaría.
create table if not exists public.automation_button_events (
  id                 uuid primary key default gen_random_uuid(),
  flow_id            uuid not null references public.automation_flows(id) on delete cascade,
  conversation_id    uuid not null references public.conversations(id) on delete cascade,

  -- El click: la burbuja entrante que dejó el botón en la bandeja.
  inbound_message_id uuid not null unique
    references public.messages(id) on delete cascade,

  -- La plantilla que llevaba el botón, para poder reconstruir el hilo.
  source_message_id  uuid references public.messages(id) on delete set null,

  -- Texto del botón tal como vino en el webhook.
  button_text        text not null,

  -- La respuesta que encolamos. NULL + `error` = no se pudo.
  reply_message_id   uuid references public.messages(id) on delete set null,
  error              text,

  created_at         timestamptz not null default now()
);

comment on table public.automation_button_events is
  'Clicks en los botones de una plantilla de automatización que el CRM contestó solo. La escribe worker/button-replies.ts.';

-- Para la tarjeta del flujo: "se contestaron N botones en los últimos días".
create index if not exists automation_button_events_flow_idx
  on public.automation_button_events (flow_id, created_at desc);

alter table public.automation_button_events enable row level security;

-- El worker escribe con service_role (bypassea RLS). El personal solo lee:
-- es historial, no hay nada que editar a mano.
drop policy if exists automation_button_events_select_staff
  on public.automation_button_events;
create policy automation_button_events_select_staff
  on public.automation_button_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- PostgREST tiene que enterarse de la columna y la tabla nuevas.
notify pgrst, 'reload schema';
