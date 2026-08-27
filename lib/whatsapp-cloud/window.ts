/**
 * La ventana de servicio de la WhatsApp Cloud API, en un solo lugar.
 *
 * Meta acepta texto libre solo durante las 24 h que siguen al último mensaje
 * de la clienta; afuera de esa ventana la única forma de escribir es una
 * plantilla aprobada, que además la reabre. Ese plazo lo miran tres lugares
 * que no comparten proceso —el worker antes de mandar, la ingesta cuando
 * llega el acuse de rechazo, y la bandeja para mostrar el contador— así que
 * el número y el texto del error viven acá y no copiados en cada uno.
 *
 * Módulo sin dependencias de servidor a propósito: lo importa un componente
 * "use client" (a diferencia de `client.ts`, que maneja el token).
 */

/** 24 h desde el último mensaje entrante de la clienta. */
export const CLOUD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * El motivo que queda guardado en `messages.error` cuando el envío se cae por
 * la ventana — lo escriba el pre-chequeo del worker o el acuse `failed` de
 * Meta (código 131047). La bandeja lo reconoce con `isOutsideWindowError`
 * para ofrecer el botón de plantilla en la burbuja roja, así que el texto es
 * parte del contrato: cambiarlo acá los mantiene a los dos en línea.
 */
export const OUTSIDE_WINDOW_ERROR =
  "Fuera de la ventana de 24 h: mandá una plantilla para reabrir la conversación.";

/** ¿Este mensaje falló por estar fuera de la ventana de 24 h? */
export function isOutsideWindowError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  // `startsWith` y no `===`: el acuse de Meta puede venir con detalle pegado.
  return error.startsWith(OUTSIDE_WINDOW_ERROR);
}

/**
 * Lo que falta para que se cierre la ventana, en ms. Negativo si ya cerró
 * (el valor sirve para decir hace cuánto), null si nunca escribieron.
 */
export function windowLeftMs(
  lastInboundAt: string | null,
  now: number,
): number | null {
  if (!lastInboundAt) return null;
  return new Date(lastInboundAt).getTime() + CLOUD_WINDOW_MS - now;
}

/**
 * El contador tal como se lee en la bandeja. El reloj de la bandeja late una
 * vez por minuto, así que no hay segundos: por debajo del minuto se dice
 * "menos de 1 min" en vez de mostrar un cero que todavía no es cierto.
 */
export function formatWindowLeft(ms: number): string {
  if (ms <= 0) return "0 min";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  // Los días solo aparecen contando hacia atrás ("cerró hace 3 d"): la
  // ventana mide 24 h, así que hacia adelante nunca se llega acá.
  if (minutes >= 1_440) {
    const days = Math.floor(minutes / 1_440);
    const rest = Math.floor((minutes % 1_440) / 60);
    return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Los tramos con los que la bandeja pinta el contador. No son reglas de Meta
 * —para Meta la ventana está abierta o cerrada— sino margen de maniobra del
 * salón: con menos de 2 h ya conviene contestar ahora o preparar la plantilla.
 */
export const WINDOW_URGENT_MS = 2 * 60 * 60 * 1000;
export const WINDOW_WARM_MS = 6 * 60 * 60 * 1000;

export type WindowLevel = "ok" | "warm" | "urgent" | "closed";

/**
 * En qué tramo cae lo que queda de ventana. `null` (nunca escribieron) cuenta
 * como cerrada: tampoco se puede mandar texto libre.
 */
export function windowLevel(leftMs: number | null): WindowLevel {
  if (leftMs === null || leftMs <= 0) return "closed";
  if (leftMs <= WINDOW_URGENT_MS) return "urgent";
  if (leftMs <= WINDOW_WARM_MS) return "warm";
  return "ok";
}

/**
 * La versión corta del contador, para la fila de la lista, donde compite por
 * el ancho con el nombre, la vista previa y las etiquetas. Redondea a la hora
 * hacia abajo ("8 h" hasta que faltan 7 h 59): el minuto exacto solo importa
 * en el último tramo, y ahí ya se está contando en minutos.
 */
export function formatWindowShort(ms: number): string {
  if (ms <= 0) return "0 min";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}
