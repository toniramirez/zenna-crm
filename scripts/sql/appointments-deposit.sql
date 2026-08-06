-- ─────────────────────────────────────────────────────────────────────────
-- Seña / adelanto en turnos — columnas que faltaban en producción
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--   El commit 1c3693f agregó la seña: el código empezó a pedir
--   `deposit_amount` / `deposit_method` en las consultas y a escribirlas al
--   crear turnos, y las declaró en types/database.types.ts. Pero el ALTER
--   TABLE nunca se corrió contra la base.
--
--   Efecto: PostgREST rechazaba la consulta entera de "Pendientes de cobro"
--   con `column appointments.deposit_amount does not exist`, la Caja lo
--   mostraba como lista vacía, y los turnos del día quedaban sin cobrar sin
--   que nadie se enterara.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── columnas de la seña ───────────────────────────────────────────────
-- `deposit_amount` es NOT NULL con default 0 porque el código lo lee sin
-- coalesce en varios lugares y trata 0 como "sin seña".
-- `deposit_method` es nullable a propósito: solo tiene sentido cuando hay
-- seña, y usa el mismo enum que `payments.method`.
alter table public.appointments
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists deposit_method public.payment_method;

-- Espejo de la validación de lib/validations/appointments.ts: la seña no
-- puede ser negativa. Va como constraint separado para poder correr el
-- script de nuevo sin chocar con uno ya existente.
alter table public.appointments
  drop constraint if exists appointments_deposit_amount_non_negative;

alter table public.appointments
  add constraint appointments_deposit_amount_non_negative
  check (deposit_amount >= 0);

comment on column public.appointments.deposit_amount is
  'Seña / adelanto cobrado al agendar. 0 = sin seña. Se descuenta del saldo al cobrar en Caja.';

comment on column public.appointments.deposit_method is
  'Método con el que se pagó la seña. NULL cuando deposit_amount = 0.';

-- 2 ─── refrescar el cache de esquema de PostgREST ────────────────────────
-- Supabase suele recargarlo solo tras un DDL, pero forzarlo evita quedar
-- otro rato con el mismo error mientras el cache viejo sigue vivo.
notify pgrst, 'reload schema';
