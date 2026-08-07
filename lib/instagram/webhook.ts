import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Identifica un secret en los logs sin exponerlo. Es el mismo valor que sale de
 * `printf '%s' "<secret>" | sha256sum | cut -c1-8`, así que se puede comparar
 * un secret candidato contra lo que loguea producción sin pegarlo en ningún lado.
 */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/**
 * Valida la firma `X-Hub-Signature-256` que Meta manda en cada webhook, contra
 * cada uno de los secrets candidatos. Devuelve el fingerprint del que cerró, o
 * `null` si no cerró ninguno.
 *
 * Sin esto, cualquiera que conozca la URL puede inyectar mensajes falsos en la
 * bandeja. La firma es HMAC-SHA256 del cuerpo **crudo** con el app secret, así
 * que hay que firmar el body tal cual llegó: si se re-serializa el JSON, la
 * firma no cierra.
 *
 * Devolver el fingerprint y no un booleano es lo que después deja registrado en
 * el log *cuál* de los secrets configurados es el bueno.
 */
export function matchSignature(args: {
  rawBody: string;
  header: string | null;
  appSecrets: string[];
}): string | null {
  if (!args.header) return null;

  const [algo, signature] = args.header.split("=");
  if (algo !== "sha256" || !signature) return null;

  const received = Buffer.from(signature, "hex");

  for (const secret of args.appSecrets) {
    const expected = Buffer.from(
      createHmac("sha256", secret).update(args.rawBody, "utf8").digest("hex"),
      "hex",
    );
    // timingSafeEqual explota si los largos difieren, así que se chequea antes.
    if (received.length !== expected.length) continue;
    if (timingSafeEqual(received, expected)) return secretFingerprint(secret);
  }

  return null;
}

/**
 * Detalle para el log cuando no cerró ninguno.
 *
 * "Firma inválida" a secas no distingue causas que se arreglan de forma muy
 * distinta: que ninguno de los secrets configurados sea el que firma, que el
 * header no venga, o que el cuerpo haya llegado alterado. Los secrets nunca se
 * loguean — sale su largo y su fingerprint, que alcanzan para saber cuáles se
 * probaron sin exponer ninguno.
 */
export function describeSignatureMismatch(args: {
  rawBody: string;
  header: string | null;
  appSecrets: string[];
}): string {
  const [algo, received] = (args.header ?? "").split("=");

  const tried = args.appSecrets
    .map((secret) => {
      const expected = createHmac("sha256", secret)
        .update(args.rawBody, "utf8")
        .digest("hex");
      return `${secret.length}ch/${secretFingerprint(secret)}→${expected.slice(0, 12)}`;
    })
    .join(" ");

  return [
    `algo=${algo || "(sin header)"}`,
    `recibida=${received ? received.slice(0, 12) : "(vacía)"}`,
    `body=${args.rawBody.length}b`,
    `probados=[${tried || "ninguno"}]`,
  ].join(" ");
}

// ─────────────────────────────────────────── Forma del payload
//
// Los webhooks de mensajería de Instagram usan el formato de la plataforma de
// Messenger: `entry[].messaging[]`. (Los webhooks de comentarios/menciones, que
// hoy no consumimos, llegan como `entry[].changes[]`.)

export type IgAttachment = {
  type?: string;
  payload?: { url?: string; sticker_id?: string; title?: string };
};

export type IgMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  // Meta no es consistente con el tipo: ver `eventTimestamp`.
  timestamp?: number | string;
  message?: {
    mid?: string;
    text?: string;
    attachments?: IgAttachment[];
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { mid?: string; story?: { id?: string; url?: string } };
  };
  reaction?: {
    mid?: string;
    action?: "react" | "unreact";
    emoji?: string;
    reaction?: string;
  };
  read?: { mid?: string };
  postback?: { mid?: string; title?: string; payload?: string };
};

export type IgWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: IgMessaging[];
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
};

export function parseWebhookBody(raw: string): IgWebhookBody | null {
  try {
    const parsed = JSON.parse(raw) as IgWebhookBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * ¿Este objeto tiene forma de evento de mensajería?
 *
 * Se usa para decidir si un `changes[].value` se puede tratar como si hubiera
 * venido por `messaging[]`. Pedimos que traiga al menos remitente/destinatario
 * y algo accionable (mensaje, reacción o acuse de lectura).
 */
function looksLikeMessagingEvent(value: unknown): value is IgMessaging {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const hasParty = "sender" in v || "recipient" in v;
  const hasPayload = "message" in v || "reaction" in v || "read" in v;
  return hasParty && hasPayload;
}

/**
 * Aplana los eventos de un webhook a una sola lista.
 *
 * Meta entrega el campo `messages` en dos formas según cómo esté configurada la
 * app: el formato de la plataforma de Messenger (`entry[].messaging[]`) y el
 * formato genérico de webhooks (`entry[].changes[]` con `field: "messages"`).
 * Leemos las dos — asumir una sola significaba descartar todo en silencio.
 *
 * Los `changes` de otros campos (comentarios, menciones) se ignoran: no los
 * consumimos todavía y no tienen forma de evento de mensajería.
 */
export function flattenMessagingEvents(body: IgWebhookBody): IgMessaging[] {
  return (body.entry ?? []).flatMap((entry) => {
    const fromMessaging = entry.messaging ?? [];

    const fromChanges = (entry.changes ?? [])
      .filter((change) => change.field === "messages")
      .map((change) => change.value)
      .filter(looksLikeMessagingEvent);

    return [...fromMessaging, ...fromChanges];
  });
}

/**
 * Fecha del evento, en ISO y a prueba de las tres formas en que Meta manda
 * `timestamp`.
 *
 * Por `messaging[]` llega un número en milisegundos, pero por `changes[]` —y en
 * el payload de prueba del App Dashboard— puede llegar como **string** y en
 * **segundos**. Las dos variantes rompían: `new Date("1527459824")` es Invalid
 * Date y `.toISOString()` sobre eso tira `RangeError`, que se comía el evento
 * entero antes de insertar el mensaje. Y un valor en segundos tomado como
 * milisegundos fecha el mensaje en 1970 y lo manda al fondo de la bandeja.
 *
 * Si no se puede interpretar, la hora de llegada es mejor aproximación que
 * perder el mensaje: el webhook se procesa a los segundos de que Meta lo emite.
 */
export function eventTimestamp(raw: number | string | undefined): string {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;

  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    // El corte en 1e12 es ~septiembre de 2001 leído como milisegundos: cualquier
    // valor por debajo es, sin ambigüedad, un epoch en segundos.
    const ms = n < 1e12 ? n * 1000 : n;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return new Date().toISOString();
}

/**
 * Mapea el `type` de un adjunto de Instagram al `message_type` del CRM.
 * `share` (posts/reels reenviados) y `story_mention` los tratamos como imagen:
 * Meta manda una URL de preview y es lo que la recepcionista necesita ver.
 */
export function attachmentToMessageType(
  type: string | undefined,
): "image" | "video" | "audio" | "document" | "sticker" | null {
  switch (type) {
    case "image":
    case "share":
    case "story_mention":
      return "image";
    case "video":
    case "ig_reel":
    case "reel":
      return "video";
    case "audio":
      return "audio";
    case "file":
      return "document";
    default:
      return null;
  }
}
