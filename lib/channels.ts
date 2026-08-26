/**
 * Los canales de la bandeja, y cuál manda.
 *
 * El salón migró de número: el viejo entra por Baileys (canal `whatsapp`) y
 * el nuevo por la Cloud API oficial de Meta (canal `whatsapp_cloud`). Los dos
 * siguen conectados, pero no son pares:
 *
 * - **Principal** — `whatsapp_cloud` + `instagram`. Es la bandeja que se abre
 *   en /crm y de donde salen TODAS las automatizaciones.
 * - **Archivo** — `whatsapp` (Baileys). Queda a un botón de distancia, con su
 *   historial intacto y el composer vivo por si hay que contestarle a alguien
 *   que insiste por el número viejo. Nada automático sale de ahí, salvo el
 *   aviso de redirección al número nuevo.
 *
 * Este módulo es la única fuente de esa decisión: importarlo en vez de
 * escribir `"whatsapp_cloud"` a mano es lo que hace que el día que se apague
 * Baileys (o que aparezca un tercer canal) haya un solo lugar que tocar.
 */

/** WhatsApp oficial de Meta. El número nuevo; el canal principal. */
export const WA_CLOUD_CHANNEL = "whatsapp_cloud";

/** WhatsApp por Baileys. El número viejo, en modo archivo + redirección. */
export const WA_LEGACY_CHANNEL = "whatsapp";

export const INSTAGRAM_CHANNEL = "instagram";

/** Lo que se ve en la bandeja principal. */
export const PRIMARY_CHANNELS = [
  WA_CLOUD_CHANNEL,
  INSTAGRAM_CHANNEL,
] as const;

/**
 * Por dónde salen las automatizaciones, el turnero y todo lo que el CRM manda
 * sin que nadie escriba primero. Es una sola constante y no una lista: mandar
 * lo mismo por dos canales le llegaría duplicado a la clienta.
 */
export const OUTBOUND_WA_CHANNEL = WA_CLOUD_CHANNEL;

export function isPrimaryChannel(channel: string | null | undefined): boolean {
  return channel === WA_CLOUD_CHANNEL || channel === INSTAGRAM_CHANNEL;
}

export function isLegacyChannel(channel: string | null | undefined): boolean {
  return channel === WA_LEGACY_CHANNEL;
}

/**
 * Dígitos de un teléfono en formato internacional, o null si no parece uno.
 *
 * El campo de la ficha es libre ("+54 9 351 123-4567", "3511234567", …) y el
 * `wa_id` de Meta son los dígitos pelados, así que todo lo que compare
 * números pasa por acá primero.
 */
export function phoneDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * Los últimos 8 dígitos: la parte del número que no cambia se lo escriba como
 * se lo escriba. El prefijo internacional, el 0 y el 15 de los celulares
 * argentinos aparecen y desaparecen según quién haya cargado el contacto — y
 * Meta además devuelve los números argentinos sin el 9 en el `wa_id`.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = phoneDigits(raw);
  return digits ? digits.slice(-8) : null;
}
