-- ─────────────────────────────────────────────────────────────────────────
-- Caja: corregir el método de pago de una venta ya cobrada
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de
-- caja-ventas-y-controles.sql. Es idempotente: se puede volver a correr.
--
-- QUÉ HACE
--   Una venta cerrada no se podía tocar: si se cargó "efectivo" y era una
--   transferencia, el efectivo a rendir quedaba mal para siempre. Esta función
--   cambia el método de uno o más pagos (seña o cobro) en una transacción.
--
--   · Sólo cambia el método: el importe, el día de caja y la hora quedan
--     igual. Los totales de la Caja y de Finanzas se recalculan solos.
--   · Una seña se corrige en el turno (deposit_method), igual que si se
--     editara el turno, para que appointments_sync_deposit no la pise después.
--   · Si la caja de ese pago ya se cerró, sólo la dueña puede cambiarlo: es
--     la misma regla que "corregir un cierre ya hecho".
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.cambiar_metodo_pago(p_changes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_change jsonb;
  v_method public.payment_method;
  v_payment public.payments%rowtype;
  v_count integer := 0;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and p.role in ('owner', 'receptionist');
  if not found then
    raise exception 'sin permiso para cambiar pagos' using errcode = '42501';
  end if;

  for v_change in
    select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  loop
    v_method := (v_change->>'method')::public.payment_method;

    select * into v_payment
    from public.payments
    where id = (v_change->>'id')::uuid
    for update;
    if not found then
      raise exception 'pago inexistente' using errcode = 'P0002';
    end if;

    continue when v_payment.method = v_method;

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
          deposit_paid_on = v_payment.caja_date
      where id = v_payment.appointment_id
        and deposit_amount = v_payment.amount;
    end if;

    update public.payments
    set method = v_method
    where id = v_payment.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cambiar_metodo_pago(jsonb) from public, anon;
grant execute on function public.cambiar_metodo_pago(jsonb) to authenticated;

notify pgrst, 'reload schema';
