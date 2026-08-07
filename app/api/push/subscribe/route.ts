import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Alta y baja de dispositivos para notificaciones push.
 *
 * Es un route handler y no una server action porque el service worker también
 * lo llama, desde `pushsubscriptionchange`, cuando Apple o Google rotan la
 * suscripción por su cuenta. Ahí no hay componente de React del otro lado.
 */

export const dynamic = "force-dynamic";

type SubscriptionJson = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  let payload: { subscription?: SubscriptionJson; oldEndpoint?: string | null };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const sub = payload.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "Faltan datos de la suscripción." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userAgent = request.headers.get("user-agent");

  // Camino normal: el usuario activa las notificaciones desde la app.
  if (user) {
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      console.error("[push] no se pudo guardar la suscripción:", error.message);
      return NextResponse.json(
        { error: "No pudimos guardar la suscripción." },
        { status: 500 },
      );
    }

    // Si el navegador rotó el endpoint, el viejo ya no despierta a nadie.
    if (payload.oldEndpoint && payload.oldEndpoint !== endpoint) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", payload.oldEndpoint);
    }

    return NextResponse.json({ ok: true });
  }

  /*
   * Rotación disparada por el service worker sin sesión válida (pasa cuando el
   * token de Supabase expiró y la app está cerrada). Se acepta solo si el
   * endpoint viejo ya estaba registrado: eso prueba que el dispositivo era
   * nuestro, y hereda el user_id de esa fila.
   */
  if (!payload.oldEndpoint) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: previous } = await service
    .from("push_subscriptions")
    .select("id, user_id")
    .eq("endpoint", payload.oldEndpoint)
    .maybeSingle();

  if (!previous) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  await service
    .from("push_subscriptions")
    .update({ endpoint, p256dh, auth, user_agent: userAgent })
    .eq("id", previous.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let endpoint: string | undefined;
  try {
    const body = await request.json();
    endpoint = body?.endpoint;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  if (!endpoint) {
    return NextResponse.json({ error: "Falta el endpoint." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  // RLS ya limita el delete a las filas propias; el filtro por user_id es
  // explícito para que se lea sin tener que ir a buscar la política.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "No pudimos borrar la suscripción." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
