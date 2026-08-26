import { addDays, startOfDay } from "date-fns";
import { requireRole } from "@/lib/auth";
import { PRIMARY_CHANNELS, WA_LEGACY_CHANNEL } from "@/lib/channels";
import { INBOX_LIMIT } from "@/lib/inbox-unread";
import { createClient } from "@/lib/supabase/server";
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import type { AppointmentWithRelations } from "../turnos/types";
import type {
  AutomationFlow,
  ClientTag,
  PaymentMethod,
  QuickReply,
  ServiceSlim,
} from "./config-types";
import { CrmShell } from "./crm-shell";
import type { OutreachSuggestionWithRelations } from "./outreach-types";
import type { ConversationWithClient } from "./types";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ c?: string; tab?: string }>;
};

/**
 * Window of appointments to pre-load for the in-chat mini-agenda. Anything
 * outside this range simply won't render until the user reloads. We bias
 * forward because the receptionist is almost always booking future slots.
 */
function appointmentWindow(now: Date) {
  const start = startOfDay(addDays(now, -3));
  const end = startOfDay(addDays(now, 28));
  return { start, end };
}

export default async function CrmPage({ searchParams }: Props) {
  await requireRole(["owner", "receptionist"]);
  const { c, tab } = await searchParams;
  const initialTab: "chat" | "config" = tab === "config" ? "config" : "chat";

  const supabase = await createClient();
  const { start, end } = appointmentWindow(new Date());

  // Fetch everything for both tabs at once. Cheap and avoids client-side
  // loading states when switching tabs.
  const [
    conversationsResult,
    legacyResult,
    tagsResult,
    repliesResult,
    flowsResult,
    servicesFullResult,
    professionalsResult,
    clientsResult,
    appointmentsResult,
    paymentMethodsResult,
    outreachResult,
    waTemplatesResult,
  ] = await Promise.all([
    // Bandeja principal: el número nuevo (WhatsApp API) y los DMs de
    // Instagram. Va en una consulta aparte de la del número viejo, y no en una
    // sola que se parta en el cliente, para que el límite de INBOX_LIMIT sea
    // por bandeja: si no, un pico de mensajes al número viejo empujaría chats
    // vivos fuera de la lista principal.
    supabase
      .from("conversations")
      .select("*, clients ( id, full_name, phone, tags )")
      .eq("archived", false)
      .in("channel", [...PRIMARY_CHANNELS])
      // Los chats fijados van arriba de todo, como en WhatsApp.
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(INBOX_LIMIT),
    // Bandeja del número viejo (Baileys). Se carga junto con la principal
    // —son 100 filas más de la misma tabla— para que abrirla sea instantáneo:
    // es un archivo que se consulta de refilón, no una pantalla en la que se
    // espera un spinner.
    supabase
      .from("conversations")
      .select("*, clients ( id, full_name, phone, tags )")
      .eq("archived", false)
      .eq("channel", WA_LEGACY_CHANNEL)
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(INBOX_LIMIT),
    supabase.from("client_tags").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("quick_replies").select("*").order("active", { ascending: false }).order("label"),
    supabase.from("automation_flows").select("*").order("active", { ascending: false }).order("name"),
    // Una sola vuelta a `services`: antes iban dos consultas a la misma tabla
    // con el mismo filtro y el mismo orden —una con las tres columnas que usa
    // la configuración y otra con la fila entera para el diálogo de turno— y
    // las dos listas viajaban al cliente. La versión corta se recorta abajo.
    supabase
      .from("services")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name"),
    supabase
      .from("professionals")
      .select("*")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("clients")
      .select("id, full_name, phone")
      .order("full_name")
      .limit(500),
    supabase
      .from("appointments")
      .select(
        "*, appointment_services(*, services(id, name, category)), clients(id, full_name, phone)",
      )
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at"),
    supabase
      .from("payment_methods")
      .select("*")
      .order("active", { ascending: false })
      .order("sort_order")
      .order("label"),
    // Outreach inbox: pendings first (so they show on top), then recent
    // sent/dismissed for the history strip. 60-day window keeps the list
    // sized — anything older isn't useful context anyway.
    supabase
      .from("outreach_suggestions")
      .select(
        "*, clients(id, full_name, phone, last_visit_at), services(id, name)",
      )
      .gte(
        "generated_at",
        new Date(Date.now() - 60 * 86400 * 1000).toISOString(),
      )
      .order("status", { ascending: true }) // 'pending' < 'sent' < 'dismissed' alphabetically; pending shows first
      .order("generated_at", { ascending: false }),
    // Plantillas de la Cloud API para el selector del chat. Solo las
    // aprobadas: son las únicas que Meta acepta enviar.
    supabase
      .from("whatsapp_templates")
      .select("*")
      .eq("status", "APPROVED")
      .order("name"),
  ]);

  const bookingServices = servicesFullResult.data ?? [];
  const servicesSlim: ServiceSlim[] = bookingServices.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  // La bandeja va a sangre, como en el diseño de referencia: sin padding del
  // <main> y sin encabezado de página propio.
  return (
    <div data-bleed className="flex h-full min-h-0 flex-col">
      <CrmShell
        initialTab={initialTab}
        conversations={
          (conversationsResult.data as ConversationWithClient[] | null) ?? []
        }
        legacyConversations={
          (legacyResult.data as ConversationWithClient[] | null) ?? []
        }
        initialSelectedId={c ?? null}
        tags={(tagsResult.data as ClientTag[] | null) ?? []}
        quickReplies={(repliesResult.data as QuickReply[] | null) ?? []}
        waTemplates={
          (waTemplatesResult.data as WhatsappTemplateRow[] | null) ?? []
        }
        flows={(flowsResult.data as AutomationFlow[] | null) ?? []}
        services={servicesSlim}
        bookingServices={bookingServices}
        professionals={professionalsResult.data ?? []}
        clients={clientsResult.data ?? []}
        appointments={
          (appointmentsResult.data as AppointmentWithRelations[] | null) ?? []
        }
        paymentMethods={
          (paymentMethodsResult.data as PaymentMethod[] | null) ?? []
        }
        outreachSuggestions={
          (outreachResult.data as
            | OutreachSuggestionWithRelations[]
            | null) ?? []
        }
      />
    </div>
  );
}
