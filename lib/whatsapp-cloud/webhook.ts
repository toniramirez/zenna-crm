/**
 * Forma del payload de los webhooks de la WhatsApp Cloud API.
 *
 * A diferencia de Instagram —que mezcla dos formatos— acá hay uno solo:
 * `object: "whatsapp_business_account"` con `entry[].changes[]`, donde el
 * `field: "messages"` trae tanto los mensajes entrantes (`value.messages`)
 * como los acuses de los nuestros (`value.statuses`).
 *
 * La validación de firma es la misma HMAC de Meta que ya resuelve
 * `lib/instagram/webhook.ts` (matchSignature / describeSignatureMismatch):
 * esas funciones reciben los secrets por parámetro y se reusan tal cual.
 */

export type CloudMedia = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
  animated?: boolean;
};

export type CloudInboundMessage = {
  from?: string;
  id?: string;
  /** Epoch en segundos, como string. */
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: CloudMedia;
  video?: CloudMedia;
  audio?: CloudMedia;
  document?: CloudMedia;
  sticker?: CloudMedia;
  reaction?: { message_id?: string; emoji?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: Array<{
    name?: { formatted_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string }>;
  }>;
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  context?: { from?: string; id?: string };
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

export type CloudStatus = {
  id?: string;
  status?: string; // sent | delivered | read | failed
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

export type CloudMessagesValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: CloudInboundMessage[];
  statuses?: CloudStatus[];
};

/** Aviso de que una plantilla cambió de estado en el WhatsApp Manager. */
export type CloudTemplateStatusValue = {
  event?: string; // APPROVED | REJECTED | PAUSED | DISABLED | PENDING...
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
};

export type CloudWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
};

export function parseWebhookBody(raw: string): CloudWebhookBody | null {
  try {
    const parsed = JSON.parse(raw) as CloudWebhookBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export type CloudEvent =
  | { kind: "messages"; value: CloudMessagesValue }
  | { kind: "template_status"; value: CloudTemplateStatusValue };

/**
 * Aplana los `changes` de un webhook a una lista de eventos tipados. Los
 * fields que no consumimos (calidad del número, message_echoes de la
 * coexistencia con la app, etc.) se ignoran.
 */
export function flattenCloudEvents(body: CloudWebhookBody): CloudEvent[] {
  return (body.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change): CloudEvent[] => {
      if (typeof change.value !== "object" || change.value === null) return [];
      if (change.field === "messages") {
        return [{ kind: "messages", value: change.value as CloudMessagesValue }];
      }
      if (change.field === "message_template_status_update") {
        return [
          {
            kind: "template_status",
            value: change.value as CloudTemplateStatusValue,
          },
        ];
      }
      return [];
    }),
  );
}

/**
 * La Cloud API manda `timestamp` siempre como epoch en **segundos** y como
 * string. Si viniera roto, la hora de llegada es mejor que perder el mensaje.
 */
export function cloudTimestamp(raw: string | undefined): string {
  const n = Number(raw?.trim());
  if (Number.isFinite(n) && n > 0) {
    const date = new Date(n < 1e12 ? n * 1000 : n);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}
