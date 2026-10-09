-- ─────────────────────────────────────────────────────────────────────────
-- Señas que entran a la caja del día en que se cobran + cierres de caja
--
-- (Seguido por caja-ventas-y-controles.sql, que corrige cuándo un turno
-- está cobrado y mueve las señas viejas al día en que entraron.)
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de
-- appointments-deposit.sql. Es idempotente: se puede volver a correr.
--
-- QUÉ CAMBIA
--   Antes la seña vivía sólo en el turno (deposit_amount / deposit_method) y
--   recién se registraba como pago cuando se cobraba el saldo, en la caja del
--   día del TURNO. Si la clienta dejaba $10.000 en efectivo el lunes para un
--   turno del viernes, la plata estaba en el cajón el lunes pero la caja del
--   lunes no la mostraba: el arqueo no cerraba.
--
--   Ahora:
--   1. Cada pago tiene `caja_date`: el día de caja al que pertenece. Los
--      cobros de turnos siguen yendo a la caja del día del turno (lo pone un
--      trigger, así la RPC vieja no se toca); las señas van a la caja del día
--      en que se cobraron.
--   2. La seña es una fila de `payments` con `is_deposit = true`, que un
--      trigger mantiene sincronizada con el turno: se crea al guardar el turno
--      con seña, se actualiza si cambia el monto o el método y se borra si la
--      seña vuelve a 0.
--   3. `cobrar_turno` reemplaza a `record_appointment_payment` como punto de
--      entrada de la Caja: registra el saldo sin que la seña ya cargada
--      interfiera, y rechaza un segundo cobro del mismo turno.
--   4. `cash_closings` guarda el cierre de cada día: efectivo esperado,
--      efectivo contado y la diferencia. Es el "archivo" de cajas.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ─── día de caja de cada pago ─────────────────────────────────────────
alter table public.payments
  add column if not exists caja_date date,
  add column if not exists is_deposit boolean not null default false;

comment on column public.payments.caja_date is
  'Día de caja al que pertenece el pago (zona America/Argentina/Cordoba). Cobro de turno = día del turno; seña = día en que se cobró.';
comment on column public.payments.is_deposit is
  'true = seña/adelanto cobrado al agendar. La mantiene el trigger appointments_sync_deposit; no escribir a mano.';

-- Backfill: hasta hoy la caja se armaba por el día del turno, así que eso es
-- lo que vale para el histórico. Las cajas pasadas quedan igual que antes.
update public.payments p
set caja_date = (a.starts_at at time zone 'America/Argentina/Cordoba')::date
from public.appointments a
where a.id = p.appointment_id
  and p.caja_date is null;

-- Si algún pago quedó sin turno (no debería), usamos el día en que se pagó.
update public.payments
set caja_date = (paid_at at time zone 'America/Argentina/Cordoba')::date
where caja_date is null;

alter table public.payments alter column caja_date set not null;

create index if not exists payments_caja_date_idx
  on public.payments (caja_date);

-- Una sola seña por turno: el trigger hace upsert contra este índice.
create unique index if not exists payments_one_deposit_per_appointment
  on public.payments (appointment_id)
  where is_deposit;

-- Quien inserte un pago sin `caja_date` (la RPC record_appointment_payment,
-- que no conoce la columna) cae en la caja del día del turno, igual que antes.
create or replace function public.payments_default_caja_date()
returns trigger
language plpgsql
as $$
begin
  if new.caja_date is null then
    select (a.starts_at at time zone 'America/Argentina/Cordoba')::date
      into new.caja_date
    from public.appointments a
    where a.id = new.appointment_id;
  end if;
  if new.caja_date is null then
    new.caja_date := (coalesce(new.paid_at, now()) at time zone 'America/Argentina/Cordoba')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_default_caja_date on public.payments;
create trigger payments_default_caja_date
  before insert on public.payments
  for each row execute function public.payments_default_caja_date();

-- 2 ─── día en que se cobró la seña ───────────────────────────────────────
alter table public.appointments
  add column if not exists deposit_paid_on date;

comment on column public.appointments.deposit_paid_on is
  'Día de caja en que se cobró la seña. NULL cuando deposit_amount = 0.';

-- Señas existentes de turnos YA cobrados: el código viejo las insertó como
-- una línea más del cobro. Las marcamos como seña para que se vean así en la
-- Caja, sin moverlas de día (siguen en la caja del turno, donde se contaron).
with deposit_lines as (
  select distinct on (a.id) p.id as payment_id, a.id as appointment_id, p.caja_date
  from public.appointments a
  join public.payments p
    on p.appointment_id = a.id
   and p.method = a.deposit_method
   and p.amount = a.deposit_amount
  where a.deposit_amount > 0
    and not exists (
      select 1 from public.payments d
      where d.appointment_id = a.id and d.is_deposit
    )
  order by a.id, p.paid_at desc
)
update public.payments p
set is_deposit = true
from deposit_lines dl
where p.id = dl.payment_id;

-- Señas existentes de turnos TODAVÍA sin cobrar: las creamos como pago en la
-- caja del día del turno. Es lo que habría pasado con el código viejo al
-- cobrar, y así no aparece plata de golpe en cajas pasadas que ya se rindieron.
insert into public.payments (appointment_id, method, amount, is_deposit, caja_date, paid_at, notes, created_by)
select
  a.id,
  a.deposit_method,
  a.deposit_amount,
  true,
  (a.starts_at at time zone 'America/Argentina/Cordoba')::date,
  a.created_at,
  'Seña',
  a.created_by
from public.appointments a
where a.deposit_amount > 0
  and a.deposit_method is not null
  and not exists (
    select 1 from public.payments p where p.appointment_id = a.id
  );

update public.appointments a
set deposit_paid_on = p.caja_date
from public.payments p
where p.appointment_id = a.id
  and p.is_deposit
  and a.deposit_paid_on is null;

-- 3 ─── trigger: la seña del turno ⇄ su fila en payments ──────────────────
-- security definer: quien puede editar el turno puede mover su seña, sin
-- depender de las políticas de payments.
create or replace function public.appointments_sync_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.deposit_amount, 0) > 0 and new.deposit_method is not null then
    insert into public.payments (appointment_id, method, amount, is_deposit, caja_date, notes, created_by)
    values (
      new.id,
      new.deposit_method,
      new.deposit_amount,
      true,
      coalesce(new.deposit_paid_on, (now() at time zone 'America/Argentina/Cordoba')::date),
      'Seña',
      auth.uid()
    )
    on conflict (appointment_id) where is_deposit
    do update set
      method = excluded.method,
      amount = excluded.amount,
      caja_date = excluded.caja_date;
  else
    delete from public.payments
    where appointment_id = new.id and is_deposit;
  end if;
  return null;
end;
$$;

drop trigger if exists appointments_sync_deposit on public.appointments;
create trigger appointments_sync_deposit
  after insert or update of deposit_amount, deposit_method, deposit_paid_on
  on public.appointments
  for each row execute function public.appointments_sync_deposit();

-- 4 ─── cobrar_turno: cobro del saldo ─────────────────────────────────────
-- Envuelve a record_appointment_payment (que no está versionada en el repo)
-- para que siga haciendo lo que hacía, pero sin ver la seña: la saca antes de
-- llamarla y la vuelve a poner intacta (mismo id, paid_at y caja_date). Todo
-- en una transacción, así que si algo falla la seña no se pierde.
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
  v_deposit public.payments%rowtype;
  v_has_deposit boolean := false;
  v_count integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role in ('owner', 'receptionist')
  ) then
    raise exception 'sin permiso para cobrar' using errcode = '42501';
  end if;

  -- Bloquea el turno: dos recepcionistas apretando "Cobrar" a la vez no
  -- pueden registrar el saldo dos veces.
  perform 1 from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'turno inexistente' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.payments
    where appointment_id = p_appointment_id and not is_deposit
  ) then
    raise exception 'turno ya cobrado' using errcode = 'P0001', hint = 'ya_cobrado';
  end if;

  select * into v_deposit
  from public.payments
  where appointment_id = p_appointment_id and is_deposit;
  v_has_deposit := found;

  if v_has_deposit then
    delete from public.payments where id = v_deposit.id;
  end if;

  v_count := public.record_appointment_payment(p_appointment_id, p_lines, p_notes);

  if v_has_deposit then
    delete from public.payments where appointment_id = p_appointment_id and is_deposit;
    insert into public.payments select (v_deposit).*;
  end if;

  return v_count;
end;
$$;

revoke all on function public.cobrar_turno(uuid, jsonb, text) from public, anon;
grant execute on function public.cobrar_turno(uuid, jsonb, text) to authenticated;

-- 5 ─── cierres de caja (el archivo) ──────────────────────────────────────
-- Una fila por día cerrado. Los montos son una FOTO al momento del cierre:
-- si después se carga un cobro tardío en ese día, la pantalla lo marca como
-- "cambió desde el cierre" comparando contra lo que se calcula en vivo.
create table if not exists public.cash_closings (
  caja_date date primary key,
  cash_income numeric(12,2) not null default 0,
  cash_expenses numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2) not null,
  transfer_income numeric(12,2) not null default 0,
  other_income numeric(12,2) not null default 0,
  notes text,
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz not null default now(),
  constraint cash_closings_counted_non_negative check (counted_cash >= 0)
);

comment on table public.cash_closings is
  'Cierre de caja diario: efectivo esperado vs contado. Foto al momento de cerrar.';

alter table public.cash_closings enable row level security;

drop policy if exists cash_closings_select_staff on public.cash_closings;
create policy cash_closings_select_staff
  on public.cash_closings for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

drop policy if exists cash_closings_insert_staff on public.cash_closings;
create policy cash_closings_insert_staff
  on public.cash_closings for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.role in ('owner', 'receptionist')
    )
  );

-- Re-cerrar (corregir el conteo) y reabrir: sólo la dueña.
drop policy if exists cash_closings_update_owner on public.cash_closings;
create policy cash_closings_update_owner
  on public.cash_closings for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active and p.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active and p.role = 'owner'
    )
  );

drop policy if exists cash_closings_delete_owner on public.cash_closings;
create policy cash_closings_delete_owner
  on public.cash_closings for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active and p.role = 'owner'
    )
  );

grant select, insert, update, delete on public.cash_closings to authenticated;

-- 6 ─── refrescar el cache de esquema de PostgREST ────────────────────────
notify pgrst, 'reload schema';

-- 7 ─── verificación (correr aparte, a mano) ──────────────────────────────
-- record_appointment_payment y los triggers originales de `payments` no están
-- en el repo. Si alguno marca el turno como "completado" al insertar un pago,
-- ahora se dispararía también con la seña (que se inserta al agendar).
-- Revisar que la lista de triggers sea sólo la de este script (+ updated_at):
--
--   select tgname, pg_get_triggerdef(oid)
--   from pg_trigger
--   where tgrelid = 'public.payments'::regclass and not tgisinternal;
--
--   select pg_get_functiondef('public.record_appointment_payment'::regproc);
