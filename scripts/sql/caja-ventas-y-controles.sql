-- ─────────────────────────────────────────────────────────────────────────
-- Caja: la venta se cierra el día del turno, la seña entra el día que se cobra
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de
-- caja-senas-y-cierres.sql. Es idempotente: se puede volver a correr.
--
-- EL MODELO
--   Se agenda hoy un turno para el 20 con seña de $X:
--     · HOY entra un movimiento de dinero "seña" de $X a la caja de hoy.
--     · El 20 se cobra lo que falta: otro movimiento, en la caja del 20.
--     · La VENTA (seña + lo cobrado) queda en el día 20.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--   caja-senas-y-cierres.sql decidía si un turno estaba cobrado mirando la
--   plata: "precio de lista − seña > 0 → pendiente". Pero la mayoría de los
--   servicios tienen precio $0 (se define al atender), así que un turno con
--   seña y precio $0 quedaba como cobrado sin que nadie le cobrara el resto.
--
--   Ahora un turno está cobrado sólo cuando se CIERRA LA VENTA, y eso queda
--   registrado en `appointments.charged_at`. La seña nunca cierra la venta.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── venta cerrada ─────────────────────────────────────────────────────
alter table public.appointments
  add column if not exists charged_at timestamptz;

comment on column public.appointments.charged_at is
  'Cuándo se cerró la venta del turno (se cobró lo que faltaba, o se confirmó que la seña cubría todo). NULL = pendiente de cobro, tenga seña o no.';

-- Backfill 1: turnos con un cobro que no es seña → ya se cerraron.
update public.appointments a
set charged_at = sub.first_paid
from (
  select appointment_id, min(paid_at) as first_paid
  from public.payments
  where not is_deposit
  group by appointment_id
) sub
where sub.appointment_id = a.id
  and a.charged_at is null;

-- Backfill 2: cobros viejos donde la seña cubría todo. El código anterior
-- insertaba la seña como una línea más del cobro (con las notas del cobro),
-- y caja-senas-y-cierres.sql la marcó como seña. Las señas "puras" (creadas
-- al agendar) tienen la nota 'Seña'; las que vinieron de un cobro, no.
update public.appointments a
set charged_at = sub.paid
from (
  select appointment_id, min(paid_at) as paid
  from public.payments
  where is_deposit and notes is distinct from 'Seña'
  group by appointment_id
) sub
where sub.appointment_id = a.id
  and a.charged_at is null;

create index if not exists appointments_uncharged_idx
  on public.appointments (starts_at)
  where charged_at is null;

-- Cualquier cobro que no sea seña cierra la venta, venga de donde venga
-- (cobrar_turno, la RPC vieja o un insert a mano).
create or replace function public.payments_mark_charged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_deposit then
    update public.appointments
    set charged_at = new.paid_at
    where id = new.appointment_id
      and charged_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists payments_mark_charged on public.payments;
create trigger payments_mark_charged
  after insert on public.payments
  for each row execute function public.payments_mark_charged();

-- 2 ─── cada seña en la caja del día en que entró la plata ────────────────
-- caja-senas-y-cierres.sql dejó las señas viejas en la caja del día del
-- turno. Las movemos al día en que se recibieron:
--   · seña creada al agendar (nota 'Seña'): el día de su paid_at, que es
--     cuando se cargó;
--   · seña que entró como línea de un cobro viejo: el día en que se agendó
--     el turno (created_at), que es cuando la clienta la pagó.
-- Sólo se mueve `caja_date`: `paid_at` queda igual para no cambiar los
-- números de meses pasados en Finanzas ni las comisiones ya liquidadas.
-- No hay cierres de caja todavía, así que ningún día cerrado cambia.
with target as (
  select
    p.id,
    p.caja_date as from_date,
    (
      (case when p.notes is distinct from 'Seña' then a.created_at else p.paid_at end)
      at time zone 'America/Argentina/Cordoba'
    )::date as to_date
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.is_deposit
)
update public.payments p
set caja_date = t.to_date
from target t
where p.id = t.id
  and t.to_date is distinct from t.from_date
  -- Un día ya cerrado no gana ni pierde plata por esto.
  and not exists (
    select 1 from public.cash_closings c
    where c.caja_date in (t.from_date, t.to_date)
  );

-- El turno recuerda ese día, así editar el turno no mueve la seña.
update public.appointments a
set deposit_paid_on = p.caja_date
from public.payments p
where p.appointment_id = a.id
  and p.is_deposit
  and a.deposit_paid_on is distinct from p.caja_date;

-- 3 ─── cobrar_turno: cierra la venta ─────────────────────────────────────
-- Cambios contra la versión anterior:
--   · "ya cobrado" se decide por charged_at, no por los pagos;
--   · sin líneas también se puede cerrar, si la seña cubrió todo;
--   · cierra la venta (charged_at) y deja el turno como completado.
create or replace function public.cobrar_turno(
  p_appointment_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_deposit public.payments%rowtype;
  v_has_deposit boolean := false;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role in ('owner', 'receptionist')
  ) then
    raise exception 'sin permiso para cobrar' using errcode = '42501';
  end if;

  -- Bloquea el turno: dos personas apretando "Cobrar" a la vez no pueden
  -- cerrar la venta dos veces.
  select id, status, charged_at, deposit_amount into v_appt
  from public.appointments
  where id = p_appointment_id
  for update;
  if not found then
    raise exception 'turno inexistente' using errcode = 'P0002';
  end if;

  if v_appt.charged_at is not null then
    raise exception 'turno ya cobrado' using errcode = 'P0001', hint = 'ya_cobrado';
  end if;

  if jsonb_array_length(v_lines) = 0 and coalesce(v_appt.deposit_amount, 0) <= 0 then
    raise exception 'cobro sin monto' using errcode = 'P0001', hint = 'sin_monto';
  end if;

  if jsonb_array_length(v_lines) > 0 then
    -- record_appointment_payment no está versionada en el repo: la seguimos
    -- usando para no perder lo que hace, pero sin que vea la seña (la sacamos
    -- y la volvemos a poner intacta, en la misma transacción).
    select * into v_deposit
    from public.payments
    where appointment_id = p_appointment_id and is_deposit;
    v_has_deposit := found;

    if v_has_deposit then
      delete from public.payments where id = v_deposit.id;
    end if;

    v_count := public.record_appointment_payment(p_appointment_id, v_lines, p_notes);

    if v_has_deposit then
      delete from public.payments where appointment_id = p_appointment_id and is_deposit;
      insert into public.payments select (v_deposit).*;
    end if;
  end if;

  update public.appointments
  set charged_at = coalesce(charged_at, now()),
      status = case
        when status in ('cancelled', 'no_show') then status
        else 'completed'::public.appointment_status
      end
  where id = p_appointment_id;

  return v_count;
end;
$$;

revoke all on function public.cobrar_turno(uuid, jsonb, text) from public, anon;
grant execute on function public.cobrar_turno(uuid, jsonb, text) to authenticated;

-- 4 ─── refrescar el cache de esquema de PostgREST ────────────────────────
notify pgrst, 'reload schema';
