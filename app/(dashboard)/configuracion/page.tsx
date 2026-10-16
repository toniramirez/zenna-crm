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
import {
  appSecrets as waCloudAppSecrets,
  loadAccount as loadWaCloudAccount,
  toPublicAccount as toPublicWaCloudAccount,
  verifyToken as waCloudVerifyToken,
} from "@/lib/whatsapp-cloud/config";
import { InstagramPanel } from "./instagram-panel";
import type { LegacySettings } from "./legacy-redirect-panel";
import { NotificationsPanel } from "./notifications-panel";
import { type SettingsStatus, SettingsScreen } from "./settings-screen";
import { WhatsappCloudPanel, type TemplateSlim } from "./whatsapp-cloud-panel";
import { WhatsappPanel } from "./whatsapp-panel";
import type { Database } from "@/types/database.types";

export const dynamic = "force-dynamic";

type Status = Database["public"]["Tables"]["whatsapp_status"]["Row"];

/**
 * URL pública del webhook, para que el owner la copie al App Dashboard de Meta.
 * Se prefiere la variable de entorno (en Railway es la del dominio del deploy);
 * si no está, se deduce de los headers del request.
 */
async function resolveWebhookUrl(path: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return `${configured.replace(/\/$/, "")}${path}`;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${path}`;
}

export default async function ConfiguracionPage() {
  await requireRole("owner");

  const supabase = await createClient();
  const [{ data: status }, { data: legacySettings }] = await Promise.all([
    supabase
      .from("whatsapp_status")
      .select("*")
      .eq("session_id", "default")
      .maybeSingle(),
    // Config de la redirección del número viejo. Si todavía no se corrió
    // `whatsapp-migration.sql` esto viene con error y `data` en null, y el
    // panel muestra el aviso en vez de romper la página.
    supabase
      .from("whatsapp_legacy_settings")
      .select("*")
      .eq("session_id", "default")
      .maybeSingle(),
  ]);

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
  const webhookUrl = await resolveWebhookUrl("/api/instagram/webhook");

  // Misma lógica para la Cloud API: la tabla de credenciales es service_role-
  // only, y sin la key el panel se degrada a mostrar el aviso.
  const waCloudAccount = serviceKeyConfigured
    ? await loadWaCloudAccount(createServiceClient())
    : null;
  const waCloudWebhookUrl = await resolveWebhookUrl("/api/whatsapp/webhook");

  // El caché de plantillas sí se lee con el cliente normal: tiene política de
  // SELECT para usuarios logueados (no guarda nada sensible).
  const { data: waTemplates } = await supabase
    .from("whatsapp_templates")
    .select("id, name, language, status, category, components, rejected_reason")
    .order("status")
    .order("name");

  const waCloudPublic = toPublicWaCloudAccount(waCloudAccount);
  const instagramPublic = toPublicAccount(account);

  // Título y estado de cada integración, para la lista del teléfono (en el
  // escritorio cada panel ya lo dice en su propio encabezado).
  return (
    <SettingsScreen
      groups={[
        {
          title: "Integraciones",
          items: [
            {
              id: "whatsapp-api",
              title: "WhatsApp API",
              icon: "whatsapp-cloud",
              status: !serviceKeyConfigured
                ? { tone: "warn", label: "Falta configurar el servidor" }
                : connectionStatus(
                    waCloudPublic?.state,
                    Boolean(waCloudPublic?.has_token),
                  ),
              detail:
                waCloudPublic?.state === "connected"
                  ? waCloudPublic.display_phone_number
                  : null,
              panel: (
                <WhatsappCloudPanel
                  account={waCloudPublic}
                  templates={(waTemplates as TemplateSlim[] | null) ?? []}
                  webhookUrl={waCloudWebhookUrl}
                  verifyTokenConfigured={Boolean(waCloudVerifyToken())}
                  appSecretConfigured={waCloudAppSecrets().length > 0}
                  serviceKeyConfigured={serviceKeyConfigured}
                />
              ),
            },
            {
              id: "instagram",
              title: "Instagram",
              icon: "instagram",
              status: !serviceKeyConfigured
                ? { tone: "warn", label: "Falta configurar el servidor" }
                : connectionStatus(
                    instagramPublic?.state,
                    Boolean(instagramPublic?.has_token),
                  ),
              detail:
                instagramPublic?.state === "connected" &&
                instagramPublic.username
                  ? `@${instagramPublic.username}`
                  : null,
              panel: (
                <InstagramPanel
                  account={instagramPublic}
                  webhookUrl={webhookUrl}
                  verifyTokenConfigured={Boolean(verifyToken())}
                  appSecretConfigured={Boolean(appSecret())}
                  serviceKeyConfigured={serviceKeyConfigured}
                />
              ),
            },
            {
              id: "numero-viejo",
              title: "WhatsApp · número viejo",
              icon: "whatsapp",
              status: legacyStatus((status as Status | null)?.state),
              panel: (
                <WhatsappPanel
                  initialStatus={(status as Status | null) ?? null}
                  legacySettings={
                    (legacySettings as LegacySettings | null) ?? null
                  }
                />
              ),
            },
          ],
        },
        {
          title: "Avisos en el teléfono",
          items: [
            {
              id: "notificaciones",
              title: "Notificaciones",
              icon: "notifications",
              detail: "Mensajes nuevos de WhatsApp e Instagram",
              panel: (
                <NotificationsPanel
                  vapidPublicKey={
                    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null
                  }
                />
              ),
            },
          ],
        },
      ]}
    />
  );
}

/** Estado de una cuenta de Meta (Cloud API, Instagram) para la lista. */
function connectionStatus(
  state: string | undefined,
  hasToken: boolean,
): SettingsStatus {
  if (state === "connected" && hasToken) return { tone: "ok", label: "Conectado" };
  if (state === "error") return { tone: "error", label: "Con problemas" };
  return { tone: "off", label: "Desconectado" };
}

/**
 * Estado del número viejo según la última foto del worker. El panel lo sigue
 * en vivo; acá alcanza con la que trajo la página.
 */
function legacyStatus(state: string | undefined): SettingsStatus {
  switch (state) {
    case "connected":
      return { tone: "ok", label: "Conectado" };
    case "qr":
      return { tone: "warn", label: "Esperando escaneo del QR" };
    case "connecting":
    case "reconnect_requested":
      return { tone: "warn", label: "Conectando…" };
    default:
      return { tone: "off", label: "Desconectado" };
  }
}
