import { NextResponse } from "next/server";
import { pushConfigured, sendPushToAll } from "@/lib/push/send";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Prueba de humo desde el panel de Configuración: manda una notificación a los
 * dispositivos del usuario que la pide. Sirve para saber si el permiso quedó
 * bien dado sin tener que esperar a que escriba una clienta.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Faltan las claves VAPID en el servidor." },
      { status: 500 },
    );
  }

  // El envío lee `push_subscriptions` de todos los dispositivos del usuario;
  // con service_role para no depender de la política de select.
  const { sent } = await sendPushToAll(
    createServiceClient(),
    {
      title: "Zenna · prueba",
      body: "Si ves esto, las notificaciones están andando 🎉",
      url: "/crm",
      tag: "zenna-test",
    },
    { userId: user.id },
  );

  return NextResponse.json({ ok: true, sent });
}
