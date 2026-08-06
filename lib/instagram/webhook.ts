import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida la firma `X-Hub-Signature-256` que Meta manda en cada webhook.
 *
 * Sin esto, cualquiera que conozca la URL puede inyectar mensajes falsos en la
 * bandeja. La firma es HMAC-SHA256 del cuerpo **crudo** con el app secret, así
 * que hay que firmar el body tal cual llegó: si se re-serializa el JSON, la
 * firma no cierra.
 */
export function verifySignature(args: {
  rawBody: string;
  header: string | null;
  appSecret: string;
}): boolean {
  if (!args.header) return false;

  const [algo, signature] = args.header.split("=");
  if (algo !== "sha256" || !signature) return false;

  const expected = createHmac("sha256", args.appSecret)
    .update(args.rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  // timingSafeEqual explota si los largos difieren, así que se chequea antes.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
  timestamp?: number;
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
