import { addDays, startOfDay } from "date-fns";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
    tagsResult,
    repliesResult,
    flowsResult,
    servicesSlimResult,
    servicesFullResult,
    professionalsResult,
    clientsResult,
    appointmentsResult,
    paymentMethodsResult,
    outreachResult,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("*, clients ( id, full_name, phone, tags )")
      .eq("archived", false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from("client_tags").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("quick_replies").select("*").order("active", { ascending: false }).order("label"),
    supabase.from("automation_flows").select("*").order("active", { ascending: false }).order("name"),
    supabase
      .from("services")
      .select("id, name, category")
      .eq("active", true)
      .order("category")
      .order("name"),
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
  ]);

  // La bandeja va a sangre, como en el diseño de referencia: sin padding del
  // <main> y sin encabezado de página propio.
  return (
    <div data-bleed className="flex h-full min-h-0 flex-col">
      <CrmShell
        initialTab={initialTab}
        conversations={
          (conversationsResult.data as ConversationWithClient[] | null) ?? []
        }
        initialSelectedId={c ?? null}
        tags={(tagsResult.data as ClientTag[] | null) ?? []}
        quickReplies={(repliesResult.data as QuickReply[] | null) ?? []}
        flows={(flowsResult.data as AutomationFlow[] | null) ?? []}
        services={(servicesSlimResult.data as ServiceSlim[] | null) ?? []}
        bookingServices={servicesFullResult.data ?? []}
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
