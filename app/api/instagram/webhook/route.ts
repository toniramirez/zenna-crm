import type { NextRequest } from "next/server";
import { appSecret, loadAccount, verifyToken } from "@/lib/instagram/config";
import { ingestMessagingEvents } from "@/lib/instagram/ingest";
import {
  flattenMessagingEvents,
  parseWebhookBody,
  verifySignature,
} from "@/lib/instagram/webhook";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Webhook de Instagram Messaging.
 *
 * Esta ruta es pública a propósito — Meta la llama sin cookies ni sesión — así
 * que está exceptuada en `proxy.ts`. Lo único que la protege es la firma
 * `X-Hub-Signature-256`, y por eso la validación no es opcional: sin
 * INSTAGRAM_APP_SECRET configurado, rechazamos todo.
 */

// Nunca prerenderizar ni cachear: cada request es un evento distinto.
export const dynamic = "force-dynamic";

/**
 * GET — handshake de verificación. Meta lo llama una vez al dar de alta la URL
 * en el App Dashboard y espera que devolvamos `hub.challenge` en texto plano.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = verifyToken();
  if (!expected) {
    console.error("[instagram/webhook] falta INSTAGRAM_VERIFY_TOKEN");
    return new Response("Webhook no configurado", { status: 500 });
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Verificación fallida", { status: 403 });
}

/**
 * POST — eventos de mensajería.
 *
 * Contestamos 200 apenas validamos la firma y hacemos el trabajo pesado
 * (descargar adjuntos, escribir en la base) después de responder. Meta reintenta
 * y termina deshabilitando la suscripción si tardamos, y bajar un video desde su
 * CDN se come el presupuesto de tiempo sin problema. El reintento de Meta no
 * duplica nada: el índice único sobre `messages.external_id` lo absorbe.
 */
export async function POST(request: NextRequest) {
  const secret = appSecret();
  if (!secret) {
    console.error("[instagram/webhook] falta INSTAGRAM_APP_SECRET");
    return new Response("Webhook no configurado", { status: 500 });
  }

  // El cuerpo crudo, sin re-serializar: la firma se calcula sobre estos bytes.
  const rawBody = await request.text();

  const valid = verifySignature({
    rawBody,
    header: request.headers.get("x-hub-signature-256"),
    appSecret: secret,
  });
  if (!valid) {
    console.warn("[instagram/webhook] firma inválida — request descartado");
    return new Response("Firma inválida", { status: 401 });
  }

  const body = parseWebhookBody(rawBody);
  if (!body) return new Response("Cuerpo inválido", { status: 400 });

  // Meta manda `instagram` para esta integración. Si aparece otro objeto
  // (por ejemplo `page`), no es nuestro y lo ignoramos con un 200 para que no
  // se acumulen reintentos.
  if (body.object !== "instagram") {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const events = flattenMessagingEvents(body);

  // Log de diagnóstico. Sin esto no hay forma de distinguir "Meta nunca lo
  // mandó" de "llegó y lo descartamos": las dos se ven igual desde afuera,
  // porque a Meta siempre le contestamos 200.
  console.log(
    `[instagram/webhook] object=${body.object} entries=${body.entry?.length ?? 0} eventos=${events.length}`,
  );
  if (events.length === 0) {
    // Payload que no supimos interpretar. Se loguea entero (truncado) para
    // poder ver la forma real y ajustar el parseo.
    console.warn(
      "[instagram/webhook] sin eventos utilizables. Payload:",
      rawBody.slice(0, 2000),
    );
  }

  if (events.length > 0) {
    void processEvents(events);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processEvents(
  events: ReturnType<typeof flattenMessagingEvents>,
): Promise<void> {
  try {
    // Si falta SUPABASE_SERVICE_ROLE_KEY esto tira acá mismo. Es la causa más
    // probable de "el webhook contesta 200 pero no aparece nada en la bandeja".
    const supabase = createServiceClient();
    const account = await loadAccount(supabase);
    await ingestMessagingEvents(supabase, events, account);
    console.log(`[instagram/webhook] ${events.length} evento(s) procesado(s)`);
  } catch (err) {
    console.error(
      "[instagram/webhook] fallo procesando eventos:",
      err instanceof Error ? err.message : err,
    );
  }
}
