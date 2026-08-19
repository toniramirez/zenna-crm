import { after } from "next/server";
import type { NextRequest } from "next/server";
import {
  describeSignatureMismatch,
  matchSignature,
} from "@/lib/instagram/webhook";
import { ingestCloudEvents } from "@/lib/whatsapp-cloud/ingest";
import {
  appSecrets,
  loadAccount,
  verifyToken,
} from "@/lib/whatsapp-cloud/config";
import {
  flattenCloudEvents,
  parseWebhookBody,
} from "@/lib/whatsapp-cloud/webhook";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Webhook de la WhatsApp Cloud API (canal `whatsapp_cloud`).
 *
 * Por acá entran los mensajes de los clientes Y los acuses (sent/delivered/
 * read/failed) de los que mandamos nosotros — la Cloud API no tiene socket:
 * el envío va por el worker y todo lo demás llega por acá.
 *
 * Esta ruta es pública a propósito — Meta la llama sin cookies ni sesión — así
 * que está exceptuada en `proxy.ts`. Lo único que la protege es la firma
 * `X-Hub-Signature-256` (el HMAC es el mismo mecanismo que el webhook de
 * Instagram, de ahí que se reusen sus helpers), y por eso la validación no es
 * opcional: sin app secret configurado, rechazamos todo.
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
    console.error("[whatsapp/webhook] falta WHATSAPP_VERIFY_TOKEN");
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
 * POST — mensajes entrantes, acuses de estado y avisos de plantillas.
 *
 * Contestamos 200 apenas validamos la firma y hacemos el trabajo pesado
 * (descargar adjuntos, escribir en la base) después de responder, vía
 * `after()`: Meta reintenta y termina deshabilitando la suscripción si
 * tardamos. El reintento no duplica nada — el dedup por `external_id` lo
 * absorbe.
 */
export async function POST(request: NextRequest) {
  const secrets = appSecrets();
  if (secrets.length === 0) {
    console.error(
      "[whatsapp/webhook] falta WHATSAPP_APP_SECRET (o INSTAGRAM_APP_SECRET)",
    );
    return new Response("Webhook no configurado", { status: 500 });
  }

  // El cuerpo crudo, sin re-serializar: la firma se calcula sobre estos bytes.
  const rawBody = await request.text();

  const signature = request.headers.get("x-hub-signature-256");
  const matched = matchSignature({
    rawBody,
    header: signature,
    appSecrets: secrets,
  });
  if (!matched) {
    console.warn(
      "[whatsapp/webhook] firma inválida — request descartado:",
      describeSignatureMismatch({
        rawBody,
        header: signature,
        appSecrets: secrets,
      }),
    );
    return new Response("Firma inválida", { status: 401 });
  }

  const body = parseWebhookBody(rawBody);
  if (!body) return new Response("Cuerpo inválido", { status: 400 });

  // Para esta integración Meta manda `whatsapp_business_account`. Otro objeto
  // no es nuestro: 200 igual, para que no se acumulen reintentos.
  if (body.object !== "whatsapp_business_account") {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const events = flattenCloudEvents(body);

  // Log de diagnóstico. Sin esto no hay forma de distinguir "Meta nunca lo
  // mandó" de "llegó y lo descartamos": las dos se ven igual desde afuera,
  // porque a Meta siempre le contestamos 200.
  console.log(
    `[whatsapp/webhook] entries=${body.entry?.length ?? 0} eventos=${events.length} firma=${matched}`,
  );
  if (events.length === 0) {
    console.warn(
      "[whatsapp/webhook] sin eventos utilizables. Payload:",
      rawBody.slice(0, 2000),
    );
  }

  if (events.length > 0) {
    after(() => processEvents(events));
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processEvents(
  events: ReturnType<typeof flattenCloudEvents>,
): Promise<void> {
  try {
    // Si falta SUPABASE_SERVICE_ROLE_KEY esto tira acá mismo. Es la causa más
    // probable de "el webhook contesta 200 pero no aparece nada en la bandeja".
    const supabase = createServiceClient();
    const account = await loadAccount(supabase);
    await ingestCloudEvents(supabase, events, account);
    console.log(`[whatsapp/webhook] ${events.length} evento(s) procesado(s)`);
  } catch (err) {
    console.error(
      "[whatsapp/webhook] fallo procesando eventos:",
      err instanceof Error ? err.message : err,
    );
  }
}
