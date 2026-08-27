/**
 * Respuestas automáticas a los botones de una plantilla.
 *
 * Módulo puro a propósito, igual que `whatsapp-cloud/templates.ts`: lo
 * importan el editor de flujos (browser), la server action que lo guarda y el
 * worker que contesta. Nada de Supabase ni de Next acá adentro.
 *
 * La idea: un flujo en modo plantilla puede mandar una plantilla con botones
 * de respuesta rápida. Cuando la clienta toca uno, ese click abre la ventana
 * de 24 h de la Cloud API — y recién ahí el CRM puede contestar con lo que
 * quiera, texto libre incluido, o una imagen o un video. La respuesta NO es
 * otra plantilla justamente por eso: sería pagar por algo que ya no hace
 * falta y encima con menos libertad.
 */

/** Lo que se puede mandar como respuesta a un botón, además del texto. */
export type ButtonReplyMediaType = "image" | "video";

export type FlowButtonReply = {
  /** Texto exacto del botón en la plantilla. Es la clave del match. */
  button: string;
  /** Mini-plantilla del CRM (`{{nombre}}`). Con media, va de epígrafe. */
  body: string;
  media_type: ButtonReplyMediaType | null;
  /** Ruta dentro del bucket `wa-media`, no una URL: se firma al enviar. */
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
};

export function emptyButtonReply(button: string): FlowButtonReply {
  return {
    button,
    body: "",
    media_type: null,
    media_url: null,
    media_mime: null,
    media_filename: null,
  };
}

/**
 * Formatos que la Cloud API acepta en un mensaje de media. Se chequea al
 * subir el archivo y no al enviar: un video .mov elegido hoy fallaría recién
 * cuando una clienta toque el botón, que es el peor momento para enterarse.
 */
export const REPLY_MEDIA_MIME: Record<ButtonReplyMediaType, RegExp> = {
  image: /^image\/(jpeg|png)$/,
  video: /^video\/(mp4|3gpp?)$/,
};

export function isSendableReplyMedia(
  type: ButtonReplyMediaType,
  mime: string | null | undefined,
): boolean {
  if (!mime) return false;
  return REPLY_MEDIA_MIME[type].test(mime.split(";")[0]?.toLowerCase() ?? "");
}

/** Una respuesta sin texto ni archivo no tiene nada que mandar. */
export function hasContent(reply: FlowButtonReply): boolean {
  return reply.body.trim().length > 0 || Boolean(reply.media_url);
}

/** Lee `automation_flows.button_replies` sin confiar en su forma. */
export function buttonRepliesOf(raw: unknown): FlowButtonReply[] {
  if (!Array.isArray(raw)) return [];

  const out: FlowButtonReply[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const button = typeof r.button === "string" ? r.button.trim() : "";
    if (!button) continue;

    const mediaType =
      r.media_type === "image" || r.media_type === "video" ? r.media_type : null;
    const mediaUrl = typeof r.media_url === "string" && r.media_url ? r.media_url : null;

    out.push({
      button,
      body: typeof r.body === "string" ? r.body : "",
      // El tipo y la ruta viajan juntos o no viajan: media_url sin tipo no se
      // sabe cómo mandarla, y el tipo sin ruta no tiene qué mandar.
      media_type: mediaUrl ? mediaType : null,
      media_url: mediaType ? mediaUrl : null,
      media_mime:
        typeof r.media_mime === "string" && r.media_mime ? r.media_mime : null,
      media_filename:
        typeof r.media_filename === "string" && r.media_filename
          ? r.media_filename
          : null,
    });
  }
  return out;
}

/**
 * El texto del botón como clave de comparación.
 *
 * Meta devuelve el label tal cual quedó aprobado, así que en teoría coincide
 * carácter por carácter con el de la plantilla cacheada. En la práctica una
 * plantilla se reedita, alguien le cambia "Confirmar" por "Confirmar ✅" o le
 * corrige un acento, y el flujo quedaría mudo sin que nadie entienda por qué.
 * Comparar sin acentos, sin mayúsculas y sin emojis absorbe eso.
 */
export function normalizeButtonLabel(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // acentos
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * La respuesta configurada para el botón que tocaron, o null.
 *
 * `labels` son los textos que trajo el webhook para el mismo click: Meta manda
 * el label visible y el payload, que en las plantillas que arma el CRM son la
 * misma cosa, pero no está de más probar los dos.
 */
export function matchButtonReply(
  replies: FlowButtonReply[],
  labels: Array<string | null | undefined>,
): FlowButtonReply | null {
  const wanted = labels
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    .map(normalizeButtonLabel);
  if (wanted.length === 0) return null;

  return (
    replies.find(
      (reply) =>
        hasContent(reply) && wanted.includes(normalizeButtonLabel(reply.button)),
    ) ?? null
  );
}
