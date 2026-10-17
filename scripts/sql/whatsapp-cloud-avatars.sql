-- ─────────────────────────────────────────────────────────────────────────
-- Fotos de perfil para los chats del número nuevo (Cloud API).
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- La Cloud API no da la foto de quien escribe, así que la pide el número
-- viejo, que sigue conectado por Baileys (worker/cloud-avatars.ts). La foto
-- va al mismo `conversations.avatar_path` de siempre; esta columna solo
-- registra cuándo se miró por última vez, para que una foto privada no se
-- vuelva a pedir en cada mensaje.
--
-- Requiere haber corrido antes `whatsapp-window-countdown.sql`: el worker
-- elige los chats por `last_inbound_at`.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.conversations
  add column if not exists avatar_checked_at timestamptz;

comment on column public.conversations.avatar_checked_at is
  'Última vez que el número viejo (Baileys) buscó la foto de perfil de este chat de la Cloud API, la haya encontrado o no. NULL = todavía no se buscó. Se vuelve a buscar una vez por semana si la clienta sigue escribiendo.';

-- PostgREST tiene que enterarse de la columna nueva.
notify pgrst, 'reload schema';
