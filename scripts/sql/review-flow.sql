-- ─────────────────────────────────────────────────────────────────────────
-- Flujo "Pedido de reseña" — encuesta 1-5 por WhatsApp después de cobrar
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Qué hace:
--   1. Agrega el trigger `after_payment` al enum de automatizaciones. Es
--      reusable: cualquier flujo de mensaje común puede colgarse del cobro,
--      no solo el de reseñas.
--   2. Extiende `automation_flows` con `kind` ('message' | 'review') y los
--      campos propios del flujo de reseña (las tres respuestas por puntaje,
--      el nombre del salón y el link de Google).
--   3. Crea `review_requests`: una fila por (flujo, turno) con el puntaje que
--      contestó la clienta y el estado del caso interno cuando el puntaje es
--      bajo. Es la tabla que lee la pantalla /resenas.
--
-- OJO con el paso 1: `alter type ... add value` no puede usarse en la MISMA
-- transacción que inserta filas con el valor nuevo. Acá no insertamos ningún
-- flujo, así que corre entero sin problema; si el editor se quejara, correr
-- el bloque 1 solo y después el resto.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── trigger nuevo: después de cobrar el turno ─────────────────────────
alter type public.automation_trigger add value if not exists 'after_payment';

-- 2 ─── automation_flows: tipo de flujo + config de reseña ────────────────
-- `kind` separa los dos editores del panel: 'message' es el flujo de siempre
-- (un texto y listo) y 'review' el de la encuesta, que además de la pregunta
-- guarda las tres respuestas automáticas. Default 'message' para que las
-- filas que ya existen sigan comportándose igual.
alter table public.automation_flows
  add column if not exists kind text not null default 'message',
  add column if not exists review_salon_name text,
  add column if not exists review_google_url text,
  add column if not exists review_reply_high text,
  add column if not exists review_reply_mid text,
  add column if not exists review_reply_low text;

alter table public.automation_flows
  drop constraint if exists automation_flows_kind_check;

alter table public.automation_flows
  add constraint automation_flows_kind_check
  check (kind in ('message', 'review'));

comment on column public.automation_flows.kind is
  'message = flujo de texto simple. review = encuesta 1-5 con respuesta automática por puntaje.';
comment on column public.automation_flows.review_reply_high is
  'Respuesta cuando la clienta puntúa 5. Suele llevar el link de Google.';
comment on column public.automation_flows.review_reply_mid is
  'Respuesta cuando la clienta puntúa 3 o 4.';
comment on column public.automation_flows.review_reply_low is
  'Respuesta cuando la clienta puntúa 1 o 2.';

-- Un flujo de reseña sin sus tres respuestas quedaría mudo cuando la clienta
-- contesta el número, así que la completitud se exige en la base y no solo en
-- el formulario. `not valid` evita que la migración falle si alguien ya creó
-- filas a mano; las nuevas sí se validan.
alter table public.automation_flows
  drop constraint if exists automation_flows_review_complete_check;

alter table public.automation_flows
  add constraint automation_flows_review_complete_check
  check (
    kind <> 'review'
    or (
      review_reply_high is not null
      and review_reply_mid is not null
      and review_reply_low is not null
    )
  ) not valid;

-- 3 ─── review_requests: la encuesta enviada y su respuesta ───────────────
-- Una fila por (flujo, turno): el único índice de abajo es lo que hace que
-- dos ticks solapados del worker no manden la pregunta dos veces, igual que
-- `automation_executions` para los flujos comunes.
--
-- El caso interno vive acá y no en una tabla aparte porque es el mismo hecho
-- visto de otra forma: "puntuó 2 y todavía no lo resolvimos". Separarlo
-- obligaría a un join para la única pantalla que los mira.
create table if not exists public.review_requests (
  id                uuid primary key default gen_random_uuid(),
  flow_id           uuid not null references public.automation_flows(id) on delete cascade,
  appointment_id    uuid not null references public.appointments(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  conversation_id   uuid references public.conversations(id) on delete set null,

  -- Cuándo salió la pregunta y con qué mensaje, para poder abrir el chat
  -- justo ahí desde /resenas.
  asked_at          timestamptz not null default now(),
  question_message_id uuid references public.messages(id) on delete set null,

  -- Respuesta de la clienta. NULL mientras no conteste.
  score             smallint check (score between 1 and 5),
  answered_at       timestamptz,
  reply_message_id  uuid references public.messages(id) on delete set null,

  -- Lo que escribió después del puntaje, cuando le preguntamos qué pasó.
  feedback          text,
  feedback_at       timestamptz,

  -- Caso interno. 'none' mientras el puntaje sea alto (o no haya puntaje).
  case_status       text not null default 'none'
    check (case_status in ('none', 'open', 'resolved')),
  case_notes        text,
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null,

  created_at        timestamptz not null default now(),

  unique (flow_id, appointment_id)
);

comment on table public.review_requests is
  'Encuestas de reseña enviadas tras el cobro, con el puntaje que contestó la clienta y el caso interno que abre un puntaje bajo. La escribe worker/automations.ts; la lee /resenas.';

-- El worker busca "encuesta de esta conversación, sin contestar" en cada
-- mensaje entrante: índice parcial, que en una base sana son pocas filas.
create index if not exists review_requests_pending_idx
  on public.review_requests (conversation_id, asked_at desc)
  where score is null;

-- La pantalla de casos entra siempre por acá.
create index if not exists review_requests_open_case_idx
  on public.review_requests (answered_at desc)
  where case_status = 'open';

create index if not exists review_requests_client_idx
  on public.review_requests (client_id, asked_at desc);

alter table public.review_requests enable row level security;

-- El worker escribe con service_role (bypassea RLS). El personal lee todo y
-- solo actualiza el estado del caso desde /resenas.
drop policy if exists review_requests_select_staff on public.review_requests;
create policy review_requests_select_staff
  on public.review_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

drop policy if exists review_requests_update_staff on public.review_requests;
create policy review_requests_update_staff
  on public.review_requests for update
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
