const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined) return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return ARS_FORMATTER.format(value);
}

/**
 * Render duration in minutes as a human-friendly Spanish label:
 *   30   → "30 min"
 *   60   → "1 h"
 *   90   → "1 h 30 min"
 *   180  → "3 h"
 */
export function formatDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}
