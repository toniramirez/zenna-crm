-- ─────────────────────────────────────────────────────────────────────────
-- Caja: corregir un pago de una venta ya cobrada
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de
-- caja-ventas-y-controles.sql. Es idempotente: se puede volver a correr.
--
-- QUÉ HACE
--   Una venta cerrada no se podía tocar: si se cargó "efectivo" y era una
--   transferencia, o se tipeó mal el importe, el efectivo a rendir quedaba
--   mal para siempre. Esta función corrige uno o más pagos (seña o cobro) en
--   una transacción.
--
--   · El método se puede corregir siempre.
--   · El importe, sólo el mismo día en que se cobró (paid_at): es para el
--     error del momento, no para rehacer ventas de otros días.
--   · El día de caja y la hora no se tocan. Los totales de la Caja y de
--     Finanzas se recalculan solos.
--   · Una seña se corrige también en el turno (deposit_method /
--     deposit_amount), igual que si se editara el turno, para que
--     appointments_sync_deposit no la pise después.
--   · Si la caja de ese pago ya se cerró, sólo la dueña puede corregirlo: es
--     la misma regla que "corregir un cierre ya hecho".
-- ─────────────────────────────────────────────────────────────────────────

-- Versión anterior de este mismo script, que sólo cambiaba el método.
drop function if exists public.cambiar_metodo_pago(jsonb);

create or replace function public.corregir_pagos(p_changes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  v_change jsonb;
  v_method public.payment_method;
  v_amount numeric;
  v_payment public.payments%rowtype;
  v_count integer := 0;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and p.role in ('owner', 'receptionist');
  if not found then
    raise exception 'sin permiso para corregir pagos' using errcode = '42501';
  end if;

  for v_change in
    select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  loop
    select * into v_payment
    from public.payments
    where id = (v_change->>'id')::uuid
    for update;
    if not found then
      raise exception 'pago inexistente' using errcode = 'P0002';
    end if;

    v_method := coalesce((v_change->>'method')::public.payment_method, v_payment.method);
    v_amount := coalesce((v_change->>'amount')::numeric, v_payment.amount);

    continue when v_method = v_payment.method and v_amount = v_payment.amount;

    if v_amount <= 0 then
      raise exception 'importe inválido' using errcode = 'P0001', hint = 'importe_invalido';
    end if;

    if v_amount <> v_payment.amount
       and (v_payment.paid_at at time zone 'America/Argentina/Cordoba')::date <> v_today
    then
      raise exception 'importe de otro día' using errcode = 'P0001', hint = 'fuera_de_dia';
    end if;

    if v_role <> 'owner' and exists (
      select 1 from public.cash_closings c
      where c.caja_date = v_payment.caja_date
    ) then
      raise exception 'caja cerrada' using errcode = 'P0001', hint = 'caja_cerrada';
    end if;

    -- El trigger del turno reescribe la fila de la seña con lo que dice el
    -- turno. Fijamos deposit_paid_on al día de caja del pago para que no la
    -- mueva, y sólo tocamos el turno si su seña es este mismo importe.
    if v_payment.is_deposit then
      update public.appointments
      set deposit_method = v_method,
          deposit_amount = v_amount,
          deposit_paid_on = v_payment.caja_date
      where id = v_payment.appointment_id
        and deposit_amount = v_payment.amount;
    end if;

    update public.payments
    set method = v_method,
        amount = v_amount
    where id = v_payment.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.corregir_pagos(jsonb) from public, anon;
grant execute on function public.corregir_pagos(jsonb) to authenticated;

notify pgrst, 'reload schema';
