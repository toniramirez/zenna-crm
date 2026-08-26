-- ─────────────────────────────────────────────────────────────────────────
-- Editor de plantillas de Meta dentro del CRM.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- Hasta ahora las plantillas se armaban en el WhatsApp Manager y el CRM solo
-- las cacheaba (`whatsapp-cloud-api.sql`). Con el editor de Configuración →
-- WhatsApp API se crean, editan y borran desde acá, y aparece un estado que
-- antes no importaba: la plantilla **rechazada**. Meta manda el motivo en el
-- webhook `message_template_status_update` y sin guardarlo el panel solo
-- puede decir "Rechazada", que no le sirve a nadie para arreglarla.
--
-- Requiere haber corrido antes `whatsapp-cloud-api.sql`.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_templates
  add column if not exists rejected_reason text;

comment on column public.whatsapp_templates.rejected_reason is
  'Motivo que mandó Meta al rechazar o pausar la plantilla (webhook message_template_status_update). Se limpia cuando vuelve a aprobarse.';

-- PostgREST tiene que enterarse de la columna nueva.
notify pgrst, 'reload schema';
