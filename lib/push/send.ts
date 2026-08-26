import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { INSTAGRAM_CHANNEL, isLegacyChannel } from "@/lib/channels";
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
  /** Ícono grande del aviso. Sin esto el service worker pone el genérico. */
  icon?: string;
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
      .select("id, channel, display_name, wa_phone, external_id, clients ( full_name )")
      .eq("id", args.conversationId)
      .maybeSingle();

    const client = conversation?.clients as { full_name: string } | null;
    const name =
      client?.full_name ||
      conversation?.display_name ||
      conversation?.wa_phone ||
      (conversation?.channel === INSTAGRAM_CHANNEL
        ? "Contacto de Instagram"
        : "Contacto sin nombre");

    const isInstagram = conversation?.channel === INSTAGRAM_CHANNEL;
    // El número viejo se etiqueta distinto: quien lee el aviso en el teléfono
    // tiene que saber, antes de abrirlo, que ese chat es del archivo y que
    // contestar ahí sale por un número que ya no damos.
    const canal = isInstagram
      ? "Instagram"
      : isLegacyChannel(conversation?.channel)
        ? "WhatsApp viejo"
        : "WhatsApp";
    const text = (args.body ?? "").trim();
    const preview = text ? text.slice(0, 140) : mediaPreview(args.type ?? null);

    await sendPushToAll(supabase, {
      title: `${name} · ${canal}`,
      body: preview,
      url: `/crm?c=${args.conversationId}`,
      // Un globo de mensaje con el color del canal: en la bandeja del teléfono
      // se ve de dónde viene sin leer el título.
      icon: isInstagram ? "/icons/instagram.png" : "/icons/whatsapp.png",
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
