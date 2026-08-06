import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { renderTemplate } from "@/lib/validations/crm-config";
import type { Database } from "@/types/database.types";

type AutomationFlow =
  Database["public"]["Tables"]["automation_flows"]["Row"];

type ConversationRow = {
  id: string;
  client_id: string | null;
  display_name: string | null;
  clients: { full_name: string } | null;
};

type AppointmentRow = {
  id: string;
  client_id: string;
  starts_at: string;
  ends_at: string;
  clients: { full_name: string; phone: string | null } | null;
  professionals: { full_name: string } | null;
  appointment_services: {
    service_id: string;
    services: { name: string } | null;
  }[];
};

const TICK_WINDOW_MS = 60_000;

/**
 * Run one pass over all active automation flows. Per flow:
 *   1. Find appointments whose trigger time falls in the last 60s window.
 *   2. Apply service-filter (empty means "every service").
 *   3. Per matched appointment, attempt to claim a slot via inserting an
 *      `automation_executions` row (unique on flow+appointment, so duplicates
 *      from overlapping ticks are silently dropped).
 *   4. If claimed, render the message and enqueue it like any other outbound.
 */
export async function processAutomations(
  supabase: SupabaseClient<Database>,
) {
  const now = new Date();
  const { data: flows } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("active", true)
    .in("trigger", ["before_appointment", "after_appointment"]);
  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    try {
      const matches = await findMatchingAppointments(supabase, flow, now);
      for (const apt of matches) {
        await fireForAppointment(supabase, flow, apt, now);
      }
    } catch (err) {
      console.error(
        `[automations] flow ${flow.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Fired by the worker right after an inbound message is persisted. Checks
 * every active `on_inbound_after_inactivity` flow and enqueues a reply when
 * the gap since the last inbound (in this conversation, before the message
 * that just arrived) is at least `trigger_offset_minutes`. A brand-new
 * conversation has no prior inbound so it always passes the threshold.
 *
 * Re-entrancy: the inserted inbound message id is excluded from the lookup
 * for "previous inbound", so the message that triggered us is not its own
 * prior reference.
 */
export async function processInboundAutomations(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  inboundMessageId: string,
  inboundSentAt: Date,
) {
  const { data: flows } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("active", true)
    .eq("trigger", "on_inbound_after_inactivity");
  if (!flows || flows.length === 0) return;

  // Get the previous inbound message in this conversation (excluding the
  // one that just arrived) so we can compute the inactivity gap.
  const { data: prev } = await supabase
    .from("messages")
    .select("sent_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .neq("id", inboundMessageId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevSentAt = prev?.sent_at ? new Date(prev.sent_at) : null;

  const { data: convData } = await supabase
    .from("conversations")
    .select("id, client_id, display_name, clients ( full_name )")
    .eq("id", conversationId)
    .maybeSingle();
  const conv = convData as unknown as ConversationRow | null;
  if (!conv) return;

  for (const flow of flows) {
    try {
      await fireForInbound(
        supabase,
        flow,
        conv,
        inboundSentAt,
        prevSentAt,
      );
    } catch (err) {
      console.error(
        `[automations] inbound flow ${flow.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function fireForInbound(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  conv: ConversationRow,
  inboundSentAt: Date,
  prevSentAt: Date | null,
) {
  // Inactivity check: brand-new conversations (no previous inbound) always
  // qualify. Otherwise the gap must meet the configured threshold.
  if (prevSentAt) {
    const gapMs = inboundSentAt.getTime() - prevSentAt.getTime();
    const thresholdMs = flow.trigger_offset_minutes * 60_000;
    if (gapMs < thresholdMs) return;
  }

  const fullName = conv.clients?.full_name ?? conv.display_name ?? "";
  const firstName = fullName.split(" ")[0] ?? "";

  const body = renderTemplate(flow.message_body, {
    nombre: firstName,
    servicio: "",
    fecha: "",
    hora: "",
    profesional: "",
  });

  const now = new Date();

  const { data: execution, error: execErr } = await supabase
    .from("automation_executions")
    .insert({
      flow_id: flow.id,
      conversation_id: conv.id,
      client_id: conv.client_id,
      scheduled_for: now.toISOString(),
      status: "pending",
    })
    .select("id")
    .single();

  if (execErr || !execution) {
    console.error(
      `[automations] inbound exec insert error for flow ${flow.id}:`,
      execErr?.message,
    );
    return;
  }

  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      type: "text",
      body,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    await supabase
      .from("automation_executions")
      .update({
        status: "failed",
        error: msgErr?.message ?? "unknown insert error",
        executed_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    return;
  }

  await supabase
    .from("automation_executions")
    .update({
      status: "sent",
      message_id: msg.id,
      executed_at: new Date().toISOString(),
    })
    .eq("id", execution.id);

  console.log(
    `⚡ automation "${flow.name}" → message queued for ${fullName || conv.id}`,
  );
}

async function findMatchingAppointments(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  now: Date,
): Promise<AppointmentRow[]> {
  const offsetMs = flow.trigger_offset_minutes * 60_000;
  let lo: Date;
  let hi: Date;
  let column: "starts_at" | "ends_at";

  if (flow.trigger === "before_appointment") {
    // Fires when (starts_at - offset) is around now → starts_at around (now + offset)
    column = "starts_at";
    lo = new Date(now.getTime() + offsetMs);
    hi = new Date(now.getTime() + offsetMs + TICK_WINDOW_MS);
  } else {
    // after_appointment: ends_at around (now - offset)
    column = "ends_at";
    lo = new Date(now.getTime() - offsetMs - TICK_WINDOW_MS);
    hi = new Date(now.getTime() - offsetMs);
  }

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id, client_id, starts_at, ends_at,
      clients ( full_name, phone ),
      professionals ( full_name ),
      appointment_services ( service_id, services ( name ) )
    `,
    )
    .gte(column, lo.toISOString())
    .lt(column, hi.toISOString())
    .not("status", "in", '("cancelled","no_show")');

  if (error) {
    console.error("[automations] appointments query error:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as AppointmentRow[];

  if (flow.service_filter_ids.length === 0) return rows;

  return rows.filter((apt) =>
    apt.appointment_services.some((s) =>
      flow.service_filter_ids.includes(s.service_id),
    ),
  );
}

async function fireForAppointment(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  apt: AppointmentRow,
  now: Date,
) {
  // Find the conversation for this client. Without a conversation we can't
  // deliver the message — skip and record as a "skipped" execution so we
  // don't keep retrying forever (the unique constraint blocks future attempts).
  // El filtro por canal no es decorativo: una clienta puede tener conversación
  // de WhatsApp y de Instagram a la vez, y sin él `maybeSingle()` fallaría.
  // Las automatizaciones son deliberadamente solo-WhatsApp por ahora — Instagram
  // tiene ventana de 24 h y mandar recordatorios fuera de ella los rebota.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, external_id")
    .eq("client_id", apt.client_id)
    .eq("channel", "whatsapp")
    .maybeSingle();

  // Claim the slot — unique (flow_id, appointment_id) makes this safe under
  // concurrent ticks.
  const { data: execution, error: execErr } = await supabase
    .from("automation_executions")
    .insert({
      flow_id: flow.id,
      appointment_id: apt.id,
      client_id: apt.client_id,
      scheduled_for: now.toISOString(),
      status: conv ? "pending" : "skipped",
    })
    .select("id")
    .single();

  if (execErr) {
    // 23505 = already fired in a previous tick. Expected, swallow.
    if (execErr.code !== "23505") {
      console.error(
        `[automations] exec insert error for flow ${flow.id}:`,
        execErr.message,
      );
    }
    return;
  }

  if (!conv) {
    await supabase
      .from("automation_executions")
      .update({
        error: "Sin conversación de WhatsApp para esta clienta.",
        executed_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    return;
  }

  const services = apt.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");
  const fechaStr = format(
    parseISO(apt.starts_at),
    "EEEE d 'de' MMMM",
    { locale: es },
  );
  const horaStr = format(parseISO(apt.starts_at), "HH:mm");

  const body = renderTemplate(flow.message_body, {
    nombre: apt.clients?.full_name?.split(" ")[0] ?? "",
    servicio: services || "tu turno",
    fecha: fechaStr,
    hora: horaStr,
    profesional: apt.professionals?.full_name ?? "",
  });

  // Enqueue an outbound message. The regular outbound-poller picks it up.
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      type: "text",
      body,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    await supabase
      .from("automation_executions")
      .update({
        status: "failed",
        error: msgErr?.message ?? "unknown insert error",
        executed_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    return;
  }

  await supabase
    .from("automation_executions")
    .update({
      status: "sent",
      message_id: msg.id,
      executed_at: new Date().toISOString(),
    })
    .eq("id", execution.id);

  console.log(
    `⚡ automation "${flow.name}" → message queued for ${apt.clients?.full_name ?? apt.client_id}`,
  );
}
