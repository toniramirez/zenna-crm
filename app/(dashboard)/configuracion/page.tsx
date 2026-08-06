import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import {
  appSecret,
  loadAccount,
  toPublicAccount,
  verifyToken,
} from "@/lib/instagram/config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { InstagramPanel } from "./instagram-panel";
import { WhatsappPanel } from "./whatsapp-panel";
import type { Database } from "@/types/database.types";

export const dynamic = "force-dynamic";

type Status = Database["public"]["Tables"]["whatsapp_status"]["Row"];

/**
 * URL pública del webhook, para que el owner la copie al App Dashboard de Meta.
 * Se prefiere la variable de entorno (en Railway es la del dominio del deploy);
 * si no está, se deduce de los headers del request.
 */
async function resolveWebhookUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return `${configured.replace(/\/$/, "")}/api/instagram/webhook`;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/instagram/webhook`;
}

export default async function ConfiguracionPage() {
  await requireRole("owner");

  const supabase = await createClient();
  const { data: status } = await supabase
    .from("whatsapp_status")
    .select("*")
    .eq("session_id", "default")
    .maybeSingle();

  // `instagram_accounts` está cerrada por RLS (guarda el token), así que se lee
  // con service_role y se le saca el token antes de mandarla al cliente.
  //
  // Si la service key no está configurada NO se rompe la página: hasta ahora
  // /configuracion andaba sin ella (solo la usaba el worker) y sería una
  // regresión fea que dejara de abrir. Se degrada mostrando el aviso en el panel.
  const serviceKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const account = serviceKeyConfigured
    ? await loadAccount(createServiceClient())
    : null;
  const webhookUrl = await resolveWebhookUrl();

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Integraciones</h2>
        <WhatsappPanel initialStatus={(status as Status | null) ?? null} />
        <InstagramPanel
          account={toPublicAccount(account)}
          webhookUrl={webhookUrl}
          verifyTokenConfigured={Boolean(verifyToken())}
          appSecretConfigured={Boolean(appSecret())}
          serviceKeyConfigured={serviceKeyConfigured}
        />
      </section>
    </div>
  );
}
