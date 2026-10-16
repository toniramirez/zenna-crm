import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  INSTAGRAM_CHANNEL,
  WA_CLOUD_CHANNEL,
  isLegacyChannel,
  phoneDigits,
} from "@/lib/channels";
import type { Database } from "@/types/database.types";

/**
 * Envío de notificaciones push (Web Push) a los dispositivos suscriptos.
 *
 * Se importa desde dos lados con runtimes distintos, así que este módulo no
 * puede depender de nada de Next:
 *   - `worker/baileys.ts`, que corre suelto con tsx (WhatsApp entrante);
 *   - el webhook de Instagram, que corre dentro del server de Next.
 *
 * El cliente de Supabase llega por parámetro y tiene que ser uno con
 * service_role: las suscripciones están cerradas por RLS.
 */

type Db = SupabaseClient<Database>;

export type PushPayload = {
  title: string;
  body: string;
  /** Adónde va la app cuando se toca la notificación. */
  url?: string;
  /** Notificaciones con el mismo tag se reemplazan en vez de apilarse. */
  tag?: string;
  /**
   * Ícono grande del aviso: una ruta del sitio o una URL absoluta (la foto de
   * perfil firmada). Sin esto el service worker pone el genérico.
   */
  icon?: string;
  /**
   * Logo chiquito del aviso en Android (silueta del canal). Sin esto va el de
   * WhatsApp. iOS no lo usa: ahí el logo es siempre el ícono de la app.
   */
  badge?: string;
};

/** Códigos con los que el servidor de push dice "este dispositivo ya no existe". */
const GONE_STATUS = new Set([404, 410]);

let vapidReady: boolean | null = null;

/**
 * Configura las claves VAPID una sola vez por proceso. Devuelve false —sin
 * tirar— si no están cargadas: sin notificaciones el CRM funciona igual, y no
 * queremos que un .env incompleto tumbe la recepción de mensajes.
 */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:hola@zenna.app";

  if (!publicKey || !privateKey) {
    console.warn(
      "[push] Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY: las notificaciones quedan apagadas.",
    );
    vapidReady = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Manda el payload a todos los dispositivos registrados. Los que responden
 * 404/410 se borran: son instalaciones que ya no existen (app desinstalada,
 * permiso revocado) y si no se limpian el envío se hace cada vez más lento.
 */
export async function sendPushToAll(
  supabase: Db,
  payload: PushPayload,
  options?: { userId?: string },
): Promise<{ sent: number; removed: number }> {
  if (!ensureVapid()) return { sent: 0, removed: 0 };

  let query = supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (options?.userId) query = query.eq("user_id", options.userId);

  const { data: subs, error } = await query;

  if (error) {
    console.error("[push] no se pudieron leer las suscripciones:", error.message);
    return { sent: 0, removed: 0 };
  }
  if (!subs || subs.length === 0) return { sent: 0, removed: 0 };

  const body = JSON.stringify(payload);
  const stale: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : 0;
        if (GONE_STATUS.has(status)) {
          stale.push(sub.id);
          return;
        }
        console.error(
          "[push] error enviando:",
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  if (stale.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", stale);
  }
  if (sent > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_sent_at: new Date().toISOString() })
      .in(
        "id",
        subs.filter((s) => !stale.includes(s.id)).map((s) => s.id),
      );
  }

  return { sent, removed: stale.length };
}

/**
 * URL firmada de la foto de perfil para usar de ícono. El bucket es privado y
 * quien baja la imagen es el teléfono, sin sesión. Un día alcanza y sobra: el
 * aviso se muestra apenas llega, y el push vence a la hora.
 */
async function avatarUrl(
  supabase: Db,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("wa-media")
    .createSignedUrl(path, 60 * 60 * 24);
  return data?.signedUrl ?? null;
}

/** Texto corto para los mensajes que no son texto. */
function mediaPreview(type: string | null): string {
  switch (type) {
    case "image":
      return "📷 Foto";
    case "video":
      return "🎥 Video";
    case "audio":
      return "🎤 Audio";
    case "document":
      return "📄 Documento";
    case "sticker":
      return "🩷 Sticker";
    default:
      return "Mensaje nuevo";
  }
}

/**
 * Notifica un mensaje entrante. Resuelve el nombre a mostrar desde la
 * conversación para que el aviso diga quién escribió y no un id.
 *
 * Nunca tira: se llama con `void` desde los caminos de ingesta y un fallo del
 * push no puede frenar el guardado del mensaje.
 */
export async function notifyInboundMessage(
  supabase: Db,
  args: {
    conversationId: string;
    /** Cuerpo del mensaje, si es de texto. */
    body?: string | null;
    /** Tipo de la fila de `messages` (text, image, audio…). */
    type?: string | null;
  },
): Promise<void> {
  try {
    if (!pushConfigured()) return;

    const { data: conversation } = await supabase
      .from("conversations")
      .select(
        "id, channel, display_name, wa_phone, external_id, avatar_path, clients ( full_name )",
      )
      .eq("id", args.conversationId)
      .maybeSingle();

    const isInstagram = conversation?.channel === INSTAGRAM_CHANNEL;
    // Sin nombre, WhatsApp muestra el número con el +. En la Cloud API el
    // número está en el external_id; en Instagram el external_id no es un
    // teléfono.
    const phone =
      phoneDigits(conversation?.wa_phone) ??
      (conversation?.channel === WA_CLOUD_CHANNEL
        ? phoneDigits(conversation.external_id)
        : null);
    const client = conversation?.clients as { full_name: string } | null;
    const name =
      client?.full_name ||
      conversation?.display_name ||
      (phone ? `+${phone}` : null) ||
      (isInstagram ? "Contacto de Instagram" : "Contacto sin nombre");

    // El título es el nombre solo, como en WhatsApp: el aviso tiene que
    // parecer un mensaje de la clienta, no un aviso de Zenna sobre un mensaje.
    // Solo se etiquetan las excepciones. Instagram, porque en iPhone el ícono
    // no se ve y sería indistinguible. El número viejo, porque quien lo lee
    // tiene que saber antes de abrirlo que contestar ahí sale por un número
    // que ya no damos.
    const title = isInstagram
      ? `${name} · Instagram`
      : isLegacyChannel(conversation?.channel)
        ? `${name} · WhatsApp viejo`
        : name;
    const text = (args.body ?? "").trim();
    const preview = text ? text.slice(0, 140) : mediaPreview(args.type ?? null);

    await sendPushToAll(supabase, {
      title,
      body: preview,
      url: `/crm?c=${args.conversationId}`,
      // La foto de perfil, como WhatsApp en Android. Sin foto, un globo con el
      // color del canal.
      icon:
        (await avatarUrl(supabase, conversation?.avatar_path)) ??
        (isInstagram ? "/icons/instagram.png" : "/icons/whatsapp.png"),
      // El logo del canal, donde WhatsApp pone el suyo.
      badge: isInstagram ? "/icons/badge-instagram.png" : "/icons/badge.png",
      // Un tag por conversación: cinco mensajes seguidos de la misma persona
      // dejan un solo aviso en pantalla, no cinco.
      tag: `conv-${args.conversationId}`,
    });
  } catch (err) {
    console.error(
      "[push] fallo notificando mensaje entrante:",
      err instanceof Error ? err.message : err,
    );
  }
}
