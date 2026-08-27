import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { shiftDateStr, ZENNA_TZ } from "@/lib/dates";

/**
 * La franja en la que el CRM se permite hacer sonar el celular de una clienta
 * por su cuenta. Fija de 9 a 21 —hora del salón, no del servidor— porque un
 * seguimiento automático a las 4 de la mañana es peor que no mandarlo.
 *
 * No es configurable a propósito: son dos números que nadie va a querer tocar
 * y meterlos en una tabla obligaría a leerla en cada vuelta del worker.
 */
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR = 21;

/** "de 9 a 21 h", para la UI. */
export const SEND_WINDOW_LABEL = `de ${SEND_WINDOW_START_HOUR} a ${SEND_WINDOW_END_HOUR} h`;

function hourInSalon(at: Date): number {
  return Number(formatInTimeZone(at, ZENNA_TZ, "H"));
}

/** ¿Es una hora razonable para escribirle a alguien? */
export function isWithinSendWindow(at: Date): boolean {
  const hour = hourInSalon(at);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/**
 * El primer momento a partir de `at` en el que se puede mandar: el mismo `at`
 * si ya cae dentro de la franja, las 9 de hoy si todavía es de madrugada, o
 * las 9 de mañana si ya pasaron las 21.
 *
 * Devolver el instante exacto (y no un booleano "ahora sí / ahora no") es lo
 * que permite guardar el envío con su hora de salida y que a las 9 se vacíe
 * la cola sola, en vez de tener que redescubrir cada chat en cada vuelta.
 */
export function nextSendWindowStart(at: Date): Date {
  if (isWithinSendWindow(at)) return at;

  const today = formatInTimeZone(at, ZENNA_TZ, "yyyy-MM-dd");
  const day =
    hourInSalon(at) < SEND_WINDOW_START_HOUR ? today : shiftDateStr(today, 1);
  const hh = String(SEND_WINDOW_START_HOUR).padStart(2, "0");

  return fromZonedTime(`${day}T${hh}:00:00.000`, ZENNA_TZ);
}
