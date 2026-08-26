import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { buildFlowMessage } from "@/lib/automations/message";
import { resolveCloudConversation } from "@/lib/whatsapp-cloud/conversations";
import type { Database } from "@/types/database.types";
import { fireReviewForAppointment } from "./reviews";

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

const APPOINTMENT_SELECT = `
  id, client_id, starts_at, ends_at,
  clients ( full_name, phone ),
  professionals ( full_name ),
  appointment_services ( service_id, services ( name ) )
`;

/**
 * Run one pass over all active automation flows. Per flow:
 *   1. Find appointments whose trigger time falls in the last 60s window.
 *   2. Apply service-filter (empty means "every service").
 *   3. Per matched appointment, attempt to claim a slot via inserting an
 *      `automation_executions` row (unique on flow+appointment, so duplicates
 *      from overlapping ticks are silently dropped).
 *   4. If claimed, render the message and enqueue it like any other outbound.
 *
 * Los flujos de reseña (`kind='review'`) comparten los pasos 1 y 2 pero
 * reclaman su turno en `review_requests`, porque la pregunta que mandan espera
 * respuesta. Ver worker/reviews.ts.
 */
export async function processAutomations(
  supabase: SupabaseClient<Database>,
) {
  const now = new Date();
  const { data: flows } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("active", true)
    .in("trigger", [
      "before_appointment",
      "after_appointment",
      "after_payment",
    ]);
  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    try {
      const matches = await findMatchingAppointments(supabase, flow, now);
      for (const apt of matches) {
        if (flow.kind === "review") {
          await fireReviewForAppointment(supabase, flow, apt);
        } else {
          await fireForAppointment(supabase, flow, apt, now);
        }
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

  // Acá la ventana de 24 h está abierta por definición —la clienta acaba de
  // escribir— así que el texto libre llega igual que una plantilla. Se usa el
  // mismo constructor de todos modos: el flujo puede estar configurado con
  // plantilla y no tiene por qué comportarse distinto según quién lo dispare.
  const built = await buildFlowMessage(supabase, flow, {
    nombre: firstName,
    servicio: "",
    fecha: "",
    hora: "",
    profesional: "",
    salon: flow.review_salon_name ?? "",
  });

  if (!built.ok) {
    console.error(
      `[automations] inbound flow ${flow.name} sin mensaje que mandar:`,
      built.error,
    );
    return;
  }

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
      body: built.content.body,
      wa_template: built.content.wa_template,
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

  if (flow.trigger === "after_payment") {
    return findPaidAppointments(supabase, flow, now, offsetMs);
  }

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
    .select(APPOINTMENT_SELECT)
    .gte(column, lo.toISOString())
    .lt(column, hi.toISOString())
    .not("status", "in", '("cancelled","no_show")');

  if (error) {
    console.error("[automations] appointments query error:", error.message);
    return [];
  }

  return applyServiceFilter(flow, (data ?? []) as unknown as AppointmentRow[]);
}

/**
 * Turnos cobrados hace `offset`. Se entra por `payments` y no por
 * `appointments` porque el cobro no deja fecha en el turno: un turno del
 * martes que se cobró el jueves tiene que disparar el jueves.
 *
 * Un cobro son varias filas de `payments` (una por método) insertadas en la
 * misma transacción, así que la lista se deduplica por turno antes de salir.
 * Aun así el único de la tabla de destino es la garantía real: dos cobros
 * parciales en momentos distintos caerían en ventanas distintas.
 */
async function findPaidAppointments(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  now: Date,
  offsetMs: number,
): Promise<AppointmentRow[]> {
  const lo = new Date(now.getTime() - offsetMs - TICK_WINDOW_MS);
  const hi = new Date(now.getTime() - offsetMs);

  const { data: paid, error: payErr } = await supabase
    .from("payments")
    .select("appointment_id")
    .gte("paid_at", lo.toISOString())
    .lt("paid_at", hi.toISOString());

  if (payErr) {
    console.error("[automations] payments query error:", payErr.message);
    return [];
  }

  const appointmentIds = [...new Set((paid ?? []).map((p) => p.appointment_id))];
  if (appointmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .in("id", appointmentIds)
    .not("status", "in", '("cancelled","no_show")');

  if (error) {
    console.error("[automations] appointments query error:", error.message);
    return [];
  }

  return applyServiceFilter(flow, (data ?? []) as unknown as AppointmentRow[]);
}

/** Sin servicios elegidos el flujo aplica a cualquier turno. */
function applyServiceFilter(
  flow: AutomationFlow,
  rows: AppointmentRow[],
): AppointmentRow[] {
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
  // El chat de la clienta en el número nuevo (Cloud API). Las automatizaciones
  // salen SIEMPRE por ahí: el número viejo de Baileys quedó como archivo y no
  // dispara nada. Instagram tampoco entra — su ventana de 24 h rebota los
  // recordatorios y no tiene plantillas con las que reabrirla.
  //
  // `createIfMissing` va atado al modo de envío, y es la diferencia que hace
  // que la migración no apague los recordatorios: en modo plantilla podemos
  // escribirle a alguien que nunca nos habló, así que abrimos el chat; en modo
  // texto libre Meta lo rebotaría fuera de la ventana, y abrir una
  // conversación vacía solo ensuciaría la bandeja.
  const wantsTemplate = flow.send_mode === "template";
  const resolved = await resolveCloudConversation(supabase, {
    clientId: apt.client_id,
    phone: apt.clients?.phone ?? null,
    displayName: apt.clients?.full_name ?? null,
    createIfMissing: wantsTemplate,
  });
  const conversationId = resolved.conversationId ?? null;

  // Claim the slot — unique (flow_id, appointment_id) makes this safe under
  // concurrent ticks.
  const { data: execution, error: execErr } = await supabase
    .from("automation_executions")
    .insert({
      flow_id: flow.id,
      appointment_id: apt.id,
      client_id: apt.client_id,
      scheduled_for: now.toISOString(),
      status: conversationId ? "pending" : "skipped",
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

  if (!conversationId) {
    await supabase
      .from("automation_executions")
      .update({
        error:
          resolved.error ??
          "Sin chat en el WhatsApp nuevo para esta clienta.",
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

  const built = await buildFlowMessage(supabase, flow, {
    nombre: apt.clients?.full_name?.split(" ")[0] ?? "",
    servicio: services || "tu turno",
    fecha: fechaStr,
    hora: horaStr,
    profesional: apt.professionals?.full_name ?? "",
    salon: flow.review_salon_name ?? "",
  });

  // Una plantilla despublicada, o una variable que quedó vacía porque el turno
  // no tenía profesional: el motivo queda en la ejecución, que es donde se
  // mira cuando "no salió el recordatorio".
  if (!built.ok) {
    await supabase
      .from("automation_executions")
      .update({
        status: "failed",
        error: built.error.slice(0, 500),
        executed_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    console.error(
      `[automations] flow ${flow.name} sin mensaje que mandar:`,
      built.error,
    );
    return;
  }

  // Enqueue an outbound message. The regular outbound-poller picks it up.
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      type: "text",
      body: built.content.body,
      wa_template: built.content.wa_template,
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
