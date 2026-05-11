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
 *   1. Suma `price_at_booking` de todos sus servicios.
 *   2. Atribuye al pago a cada profesional según su porción de precio.
 *   3. Multiplica el monto atribuido por la tasa actual de la profesional.
 *
 * Pagos sin servicios o con total de precios = 0 se ignoran (no se puede
 * atribuir).
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
    const totalPrice = services.reduce(
      (s, sv) => s + Number(sv.price_at_booking),
      0,
    );
    if (totalPrice <= 0) continue;
    const amount = Number(pay.amount);
    const priceByProf = new Map<string, number>();
    for (const sv of services) {
      priceByProf.set(
        sv.professional_id,
        (priceByProf.get(sv.professional_id) ?? 0) +
          Number(sv.price_at_booking),
      );
    }
    for (const [profId, profPrice] of priceByProf) {
      const share = (amount * profPrice) / totalPrice;
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
