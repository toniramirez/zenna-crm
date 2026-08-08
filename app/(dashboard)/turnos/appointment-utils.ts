import type { AppointmentWithRelations } from "./types";

/** Total facturable del turno = suma de las líneas de servicio. */
export function appointmentTotal(a: AppointmentWithRelations): number {
  return a.appointment_services.reduce(
    (sum, line) => sum + (line.price_at_booking ?? 0),
    0,
  );
}

/** Los cancelados / no-show no suman ni al conteo ni a la facturación. */
export function countsTowardTotals(a: AppointmentWithRelations): boolean {
  return a.status !== "cancelled" && a.status !== "no_show";
}

/** "$ 12.000" — el formato corto del toolbar de la agenda. */
export function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString("es-AR")}`;
}

/** Nombre de pila: en móvil no entra "María Fernanda Rodríguez". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Corte + Color" — los servicios del turno en una línea. */
export function servicesLabel(a: AppointmentWithRelations): string {
  return a.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");
}
