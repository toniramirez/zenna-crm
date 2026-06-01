/**
 * Lógica pura compartida: prorratea pagos entre profesionales por
 * `price_at_booking` de cada `appointment_service`, y aplica la tasa bruta
 * actual de cada profesional. La usan tanto la pestaña Profesionales (para
 * mostrar el detalle por persona) como Estadísticas (para descontar el bruto
 * del resultado neto, así esté impago todavía).
 */

export type ProrrateablePayment = {
  amount: number;
  appointments: {
    appointment_services: {
      professional_id: string;
      price_at_booking: number;
    }[];
  } | null;
};

export type GrossOwedSnapshot = {
  totalGrossOwed: number;
  /** professional_id → { paymentsAttributed, grossOwed } */
  byProfessional: Map<
    string,
    { paymentsAttributed: number; grossOwed: number }
  >;
};

/**
 * Para cada pago:
 *   1. Calcula un peso por servicio: `price_at_booking` si el turno tiene
 *      precios cargados; si están todos en 0/null, cae a peso uniforme (1 por
 *      servicio). El monto real lo aporta `payments.amount`, no la suma de
 *      precios — el prorrateo sólo decide cómo repartir ese monto entre las
 *      profesionales del turno.
 *   2. Atribuye el pago a cada profesional según su porción del peso total.
 *   3. Multiplica el monto atribuido por la tasa actual de la profesional.
 *
 * Pagos sin servicios se ignoran (no hay a quién atribuir). Cuando los precios
 * están en 0 igual se atribuye: con una sola profesional asignada le toca el
 * 100%; con varias, se reparte en partes iguales por cantidad de servicios.
 */
export function computeGrossOwed(
  payments: ProrrateablePayment[],
  professionals: { id: string; commission_rate: number }[],
): GrossOwedSnapshot {
  const rateById = new Map(
    professionals.map((p) => [p.id, Number(p.commission_rate)]),
  );

  const paymentsAttributedByProf = new Map<string, number>();

  for (const pay of payments) {
    const services = pay.appointments?.appointment_services ?? [];
    if (services.length === 0) continue;
    const amount = Number(pay.amount);
    const totalPrice = services.reduce(
      (s, sv) => s + Number(sv.price_at_booking),
      0,
    );
    // Si no hay precios cargados, repartimos por cantidad de servicios.
    const usePrice = totalPrice > 0;
    const weightByProf = new Map<string, number>();
    let totalWeight = 0;
    for (const sv of services) {
      const w = usePrice ? Number(sv.price_at_booking) : 1;
      totalWeight += w;
      weightByProf.set(
        sv.professional_id,
        (weightByProf.get(sv.professional_id) ?? 0) + w,
      );
    }
    if (totalWeight <= 0) continue;
    for (const [profId, weight] of weightByProf) {
      const share = (amount * weight) / totalWeight;
      paymentsAttributedByProf.set(
        profId,
        (paymentsAttributedByProf.get(profId) ?? 0) + share,
      );
    }
  }

  let totalGrossOwed = 0;
  const byProfessional = new Map<
    string,
    { paymentsAttributed: number; grossOwed: number }
  >();
  for (const [profId, attributed] of paymentsAttributedByProf) {
    const rate = rateById.get(profId);
    if (rate === undefined) continue;
    const gross = Math.round(((attributed * rate) / 100) * 100) / 100;
    byProfessional.set(profId, {
      paymentsAttributed: attributed,
      grossOwed: gross,
    });
    totalGrossOwed += gross;
  }

  return { totalGrossOwed, byProfessional };
}
