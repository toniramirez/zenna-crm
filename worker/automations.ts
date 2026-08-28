import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { buildFlowMessage, type FlowMessageContent } from "@/lib/automations/message";
import {
  isWithinSendWindow,
  nextSendWindowStart,
} from "@/lib/automations/quiet-hours";
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

/** Lo que el barrido de silencios necesita mirar de una conversación. */
type SilentConversationRow = ConversationRow & {
  created_at: string;
  last_inbound_at: string | null;
  last_message_at: string | null;
};

export type AppointmentRow = {
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

/** La ventana de servicio de la Cloud API: 24 h desde el último entrante. */
const CLOUD_WINDOW_MS = 24 * 60 * 60 * 1000;

export const APPOINTMENT_SELECT = `
  id, client_id, starts_at, ends_at,
  clients ( full_name, phone ),
  professionals ( full_name ),
  appointment_services ( service_id, services ( name ) )
`;

/**
 * Las variables del CRM con los datos de un turno. Es lo que se le pasa a
 * `renderTemplate` para resolver `{{fecha}}`, `{{hora}}`…
 *
 * Vive acá y no en el llamador porque lo usan dos caminos que tienen que
 * decir exactamente lo mismo: el mensaje que sale con el flujo y la respuesta
 * al botón que la clienta toque sobre ese mensaje. Que el recordatorio diga
 * "jueves 14:30" y la confirmación otra cosa sería peor que no confirmar.
 */
export function appointmentFlowContext(
  apt: AppointmentRow,
  salonName: string | null,
): Record<string, string> {
  const services = apt.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");

  return {
    nombre: apt.clients?.full_name?.split(" ")[0] ?? "",
    servicio: services || "tu turno",
    fecha: format(parseISO(apt.starts_at), "EEEE d 'de' MMMM", { locale: es }),
    hora: format(parseISO(apt.starts_at), "HH:mm"),
    profesional: apt.professionals?.full_name ?? "",
    salon: salonName ?? "",
  };
}

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

  // Acá la ventana de 24 h está abierta por definición —la clienta acaba de
  // escribir— así que el texto libre llega igual que una plantilla. Se usa el
  // mismo constructor de todos modos: el flujo puede estar configurado con
  // plantilla y no tiene por qué comportarse distinto según quién lo dispare.
  const built = await buildFlowMessage(
    supabase,
    flow,
    conversationFlowContext(fullName, flow.review_salon_name),
  );

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

  const queued = await queueFlowMessage(
    supabase,
    execution.id,
    conv.id,
    built.content,
  );
  if (!queued) return;

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
      // Guardar el chat, y no solo el turno, es lo que después permite atar el
      // click de un botón de esta plantilla a este flujo.
      conversation_id: conversationId,
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

  const built = await buildFlowMessage(
    supabase,
    flow,
    appointmentFlowContext(apt, flow.review_salon_name),
  );

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
  const queued = await queueFlowMessage(
    supabase,
    execution.id,
    conversationId,
    built.content,
  );
  if (!queued) return;

  console.log(
    `⚡ automation "${flow.name}" → message queued for ${apt.clients?.full_name ?? apt.client_id}`,
  );
}

// ─────────────────────────────────────────── Piezas compartidas

/**
 * Encola el mensaje de una ejecución y cierra su fila con el resultado.
 *
 * Los tres caminos que disparan un flujo terminan igual —insertar en
 * `messages` y dejar la ejecución en 'sent' o en 'failed' con el motivo— y ese
 * final tiene que ser idéntico: es lo que se mira cuando alguien pregunta por
 * qué no salió un mensaje. Devuelve si quedó encolado para que el llamador
 * decida qué loguear.
 */
async function queueFlowMessage(
  supabase: SupabaseClient<Database>,
  executionId: string,
  conversationId: string,
  content: FlowMessageContent,
): Promise<boolean> {
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      type: "text",
      body: content.body,
      wa_template: content.wa_template,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    await closeExecution(
      supabase,
      executionId,
      "failed",
      msgErr?.message ?? "unknown insert error",
    );
    return false;
  }

  await supabase
    .from("automation_executions")
    .update({
      status: "sent",
      message_id: msg.id,
      executed_at: new Date().toISOString(),
    })
    .eq("id", executionId);

  return true;
}

/** Cierra una ejecución sin mensaje, con el motivo a la vista en el panel. */
async function closeExecution(
  supabase: SupabaseClient<Database>,
  executionId: string,
  status: "skipped" | "failed",
  reason: string,
): Promise<void> {
  await supabase
    .from("automation_executions")
    .update({
      status,
      error: reason.slice(0, 500),
      executed_at: new Date().toISOString(),
    })
    .eq("id", executionId);
}

/**
 * Las variables de un flujo que sale de un chat y no de un turno. Solo hay
 * nombre: no hay fecha ni servicio que contar, y dejarlas vacías es mejor que
 * inventarlas —`renderTemplate` las reemplaza por nada y la frase se sostiene.
 */
function conversationFlowContext(
  fullName: string,
  salonName: string | null,
): Record<string, string> {
  return {
    nombre: fullName.split(" ")[0] ?? "",
    servicio: "",
    fecha: "",
    hora: "",
    profesional: "",
    salon: salonName ?? "",
  };
}

// ───────────────────────────── Seguimiento: la clienta no contestó

/**
 * Cuánto para atrás mira el barrido de silencios, contado desde el momento en
 * que un chat cumple el umbral del flujo.
 *
 * Existe por dos motivos. Uno: prender un flujo de "seguimiento a las 48 h" no
 * puede disparar de golpe sobre los tres mil chats muertos de los últimos dos
 * años — solo engancha lo que se apagó hace poco. Dos: si el worker estuvo
 * caído un rato, al volver recupera lo que se le pasó en vez de perderlo,
 * que es lo que pasaría con una ventana de un tick como la de los turnos.
 */
const NO_REPLY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Cuántos chats trae cada página del barrido, y cuántas páginas por vuelta. */
const NO_REPLY_PAGE = 100;
const NO_REPLY_MAX_PAGES = 5;

/** Techo de envíos que se sacan de la cola en una misma vuelta. */
const NO_REPLY_BATCH = 200;

/**
 * Cuántos días después de un turno atendido el chat sigue siendo post-venta y
 * no venta. Es la ventana en la que llega el comprobante, el "gracias" del día
 * siguiente y la encuesta de reseña: nada de eso espera respuesta nuestra, y
 * mucho menos un "¿pudiste verlo?".
 */
const POST_SERVICE_QUIET_DAYS = 7;

/**
 * Margen contra el cierre de la ventana de 24 h. Un envío que sale clavado
 * sobre la hora se arriesga a que Meta lo evalúe del otro lado del límite.
 */
const WINDOW_SAFETY_MS = 15 * 60 * 1000;

/**
 * Los flujos `no_reply_after_outbound`: el último mensaje del chat es nuestro
 * y la clienta no contestó en `trigger_offset_minutes`.
 *
 * A diferencia de todos los demás, a este no lo despierta ningún hecho —no
 * entra un mensaje, no termina un turno—, así que se barre por reloj. Son dos
 * pasadas y no una a propósito:
 *
 *   1. `scanSilentConversations` detecta el silencio y RESERVA el envío con su
 *      hora de salida (`scheduled_for`), que puede ser dentro de varias horas
 *      si el umbral se cumplió de madrugada.
 *   2. `drainNoReplyQueue` manda lo que ya tiene la hora cumplida.
 *
 * Separarlas es lo que hace que el horario funcione: el silencio se detecta
 * cuando pasa, el mensaje sale cuando corresponde, y en el medio hay una fila
 * que se puede cancelar si la clienta contesta antes.
 */
export async function processNoReplyAutomations(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
) {
  const { data: flows } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("active", true)
    .eq("trigger", "no_reply_after_outbound");

  for (const flow of flows ?? []) {
    try {
      await scanSilentConversations(supabase, flow, now);
    } catch (err) {
      console.error(
        `[automations] no-reply flow ${flow.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Va afuera del `for` y corre aunque no haya ningún flujo activo: en la cola
  // puede haber envíos de un flujo que se apagó anoche, y esas filas hay que
  // cerrarlas igual en vez de dejarlas colgadas en 'pending' para siempre.
  try {
    await drainNoReplyQueue(supabase, now);
  } catch (err) {
    console.error(
      "[automations] no-reply queue drain failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** El arranque de la racha de silencio de un chat. Nunca es null. */
function silenceAnchor(conv: SilentConversationRow): string {
  // Sin entrante nunca hubo respuesta que esperar: la racha arranca cuando se
  // abrió el chat, que también es una fecha fija. Sirve para los chats que
  // abre el propio CRM para mandar una plantilla.
  return new Date(conv.last_inbound_at ?? conv.created_at).toISOString();
}

/** ¿El último mensaje del chat es nuestro? */
function isWaitingOnClient(conv: SilentConversationRow): boolean {
  if (!conv.last_message_at) return false;
  if (!conv.last_inbound_at) return true;
  return (
    new Date(conv.last_inbound_at).getTime() <
    new Date(conv.last_message_at).getTime()
  );
}

async function scanSilentConversations(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  now: Date,
) {
  const offsetMs = flow.trigger_offset_minutes * 60_000;
  const hi = new Date(now.getTime() - offsetMs);
  const lo = new Date(hi.getTime() - NO_REPLY_LOOKBACK_MS);

  // Se recorre por páginas y no de un saque porque en régimen la mayoría de
  // los chats de la ventana ya tienen su racha atendida: sin avanzar el cursor,
  // una tanda grande —una campaña de 500 plantillas, por ejemplo— dejaría a las
  // últimas sin seguimiento nunca, porque la primera página siempre devolvería
  // las mismas 100 ya reservadas.
  let cursor = hi.toISOString();

  for (let page = 0; page < NO_REPLY_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("conversations")
      .select(
        "id, client_id, display_name, created_at, last_inbound_at, last_message_at, clients ( full_name )",
      )
      // Instagram queda afuera igual que en los flujos de turno: su ventana de
      // 24 h rebota y no tiene plantillas con las que reabrirla.
      .eq("channel", "whatsapp_cloud")
      .eq("archived", false)
      .gte("last_message_at", lo.toISOString())
      .lt("last_message_at", cursor)
      .order("last_message_at", { ascending: false })
      .limit(NO_REPLY_PAGE);

    if (error) {
      console.error("[automations] silence scan error:", error.message);
      return;
    }

    const rows = (data ?? []) as unknown as SilentConversationRow[];
    if (rows.length === 0) return;

    // El cursor es el `last_message_at` de la última fila, no un offset: la
    // lista se mueve entre página y página (cada mensaje que entra reordena la
    // bandeja) y un offset se saltearía filas. Dos chats con el timestamp
    // idéntico al microsegundo sería el único caso que se pierde una vuelta.
    cursor = rows[rows.length - 1].last_message_at ?? cursor;

    await claimSilentPage(supabase, flow, rows, now);

    if (rows.length < NO_REPLY_PAGE) return;
    if (page === NO_REPLY_MAX_PAGES - 1) {
      console.warn(
        `[automations] flow ${flow.name}: quedaron chats en silencio sin revisar (tope de ${NO_REPLY_PAGE * NO_REPLY_MAX_PAGES} por vuelta); siguen en la vuelta que viene.`,
      );
    }
  }
}

/** Reserva los seguimientos de una página del barrido. */
async function claimSilentPage(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  rows: SilentConversationRow[],
  now: Date,
) {
  const silent = rows.filter(isWaitingOnClient);
  if (silent.length === 0) return;

  // Pre-filtro contra lo ya reservado. El único de la tabla es la garantía de
  // verdad, pero sin esto cada vuelta reintentaría el mismo insert para cada
  // chat en silencio hasta que salga de la ventana de recuperación: en régimen
  // el caso normal es justamente ese, el de la racha ya atendida.
  const { data: claimed } = await supabase
    .from("automation_executions")
    .select("conversation_id, silence_anchor_at")
    .eq("flow_id", flow.id)
    .not("silence_anchor_at", "is", null)
    .in(
      "conversation_id",
      silent.map((c) => c.id),
    );

  const key = (conversationId: string, anchor: string) =>
    `${conversationId}|${new Date(anchor).getTime()}`;

  const taken = new Set(
    (claimed ?? [])
      .filter((r) => r.conversation_id && r.silence_anchor_at)
      .map((r) => key(r.conversation_id!, r.silence_anchor_at!)),
  );

  for (const conv of silent) {
    const anchor = silenceAnchor(conv);
    if (taken.has(key(conv.id, anchor))) continue;
    await claimSilenceFollowUp(supabase, flow, conv, anchor, now);
  }
}

/**
 * ¿Este chat está en etapa de venta?
 *
 * Es el filtro que separa "le mandé un presupuesto y no contestó" —que sí
 * merece un empujón— de las dos conversaciones que NO hay que perseguir:
 *
 *   · La que ya se cerró en un turno. Si tiene turno agendado la venta salió,
 *     y los recordatorios de ese turno son laburo de otro flujo.
 *   · La de post-servicio. El comprobante que llega al otro día, el "gracias":
 *     ahí el último mensaje es nuestro y nadie espera nada.
 *
 * Las dos se responden con la misma pregunta a `appointments` —¿hay algún
 * turno vivo desde hace una semana para acá?— porque `ends_at >= hoy - 7 días`
 * agarra tanto los que vienen como los recién atendidos.
 *
 * Un chat sin clienta cargada no tiene turnos que mirar: es una consulta que
 * todavía no se convirtió en nada, o sea el caso de venta más puro que hay.
 */
async function isSalesStage(
  supabase: SupabaseClient<Database>,
  clientId: string | null,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!clientId) return { ok: true };

  const since = new Date(
    now.getTime() - POST_SERVICE_QUIET_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at")
    .eq("client_id", clientId)
    .gte("ends_at", since.toISOString())
    .not("status", "in", '("cancelled","no_show")')
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Sin la respuesta no se puede afirmar que sea una venta abierta, y entre
    // mandar de más y no mandar, no mandar.
    console.error("[automations] sales-stage check error:", error.message);
    return { ok: false, reason: "No se pudo verificar si el chat tenía turnos." };
  }

  if (!data) return { ok: true };

  return {
    ok: false,
    reason:
      new Date(data.starts_at).getTime() > now.getTime()
        ? "La clienta ya tiene turno agendado: la venta está cerrada y el recordatorio del turno es otro flujo."
        : `Hubo un turno atendido en los últimos ${POST_SERVICE_QUIET_DAYS} días: el chat está en post-servicio, no en venta.`,
  };
}

/**
 * ¿El último mensaje del chat lo escribió una persona?
 *
 * Todo lo que sale del panel lleva `sent_by` con el usuario que lo mandó, y
 * todo lo que encola el worker —recordatorios, encuestas, respuestas a un
 * botón— lo deja en null. Es la diferencia exacta entre un mensaje que espera
 * respuesta y uno que solo avisa algo: nadie contesta un recordatorio de turno,
 * y perseguir a alguien por no hacerlo sería la peor versión de esta función.
 */
async function lastOutboundIsHuman(
  supabase: SupabaseClient<Database>,
  conversationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("messages")
    .select("sent_by")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .neq("type", "reaction")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Boolean(data?.sent_by);
}

/**
 * Reserva el seguimiento de una racha y le pone hora de salida.
 *
 * La hora es lo único que tiene vuelta de tuerca. Por defecto es la próxima
 * hora razonable —si el umbral se cumple a las 3 de la mañana, el mensaje
 * espera a las 9—, salvo que el flujo mande texto libre y la ventana de 24 h
 * se vaya a cerrar antes: ahí esperar sería perder el mensaje, así que sale en
 * el momento. Es la única excepción al horario, y solo aplica al modo texto —
 * una plantilla puede salir cualquier día, así que nunca tiene apuro.
 */
async function claimSilenceFollowUp(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  conv: SilentConversationRow,
  anchor: string,
  now: Date,
) {
  // Primero el estado del chat, que es lo que decide si acá hay una venta
  // abierta. Se reserva la racha con el motivo: tener turno agendado o venir de
  // un servicio no es algo que vaya a cambiar dentro de esta misma racha, así
  // que no tiene sentido volver a preguntarlo en cada vuelta.
  const sales = await isSalesStage(supabase, conv.client_id, now);
  if (!sales.ok) {
    await reserveAndClose(supabase, flow, conv, anchor, now, sales.reason);
    return;
  }

  // Este NO se reserva a propósito: que el último mensaje lo haya mandado el
  // sistema es transitorio. Si mañana una persona escribe de verdad sobre el
  // mismo silencio, ese mensaje sí merece seguimiento, y una racha quemada acá
  // se lo impediría para siempre.
  if (!(await lastOutboundIsHuman(supabase, conv.id))) return;

  const wantsTemplate = flow.send_mode === "template";
  const windowClosesAt = conv.last_inbound_at
    ? new Date(conv.last_inbound_at).getTime() + CLOUD_WINDOW_MS
    : null;

  let releaseAt = nextSendWindowStart(now);
  let forcedByWindow = false;

  if (!wantsTemplate) {
    const deadline = (windowClosesAt ?? 0) - WINDOW_SAFETY_MS;
    if (deadline <= now.getTime()) {
      // Ya no hay ventana: en modo texto no queda nada que mandar. Se reserva
      // igual —con el motivo— para no volver a evaluar esta racha en cada
      // vuelta y para que el "por qué no salió" esté escrito en algún lado.
      await reserveAndClose(
        supabase,
        flow,
        conv,
        anchor,
        now,
        conv.last_inbound_at
          ? "La ventana de 24 h ya estaba cerrada al detectar el silencio. Un seguimiento así solo puede salir con una plantilla aprobada."
          : "La clienta nunca escribió a este número, así que no hay ventana de 24 h abierta. Un seguimiento así solo puede salir con una plantilla aprobada.",
      );
      return;
    }
    if (deadline < releaseAt.getTime()) {
      releaseAt = now;
      forcedByWindow = true;
    }
  }

  const { error: execErr } = await supabase
    .from("automation_executions")
    .insert({
      flow_id: flow.id,
      conversation_id: conv.id,
      client_id: conv.client_id,
      silence_anchor_at: anchor,
      scheduled_for: releaseAt.toISOString(),
      status: "pending",
    });

  if (execErr) {
    // 23505 = otra vuelta (u otro proceso) ya reservó esta racha.
    if (execErr.code !== "23505") {
      console.error(
        `[automations] silence claim error for flow ${flow.id}:`,
        execErr.message,
      );
    }
    return;
  }

  const who = conv.clients?.full_name ?? conv.display_name ?? conv.id;
  if (releaseAt.getTime() <= now.getTime()) {
    console.log(
      `⚡ automation "${flow.name}" → seguimiento a ${who}${forcedByWindow ? " (sale ya: se cierra la ventana de 24 h)" : ""}`,
    );
  } else {
    console.log(
      `⏳ automation "${flow.name}" → seguimiento a ${who} en cola para ${releaseAt.toISOString()}`,
    );
  }

  // La cola se vacía en la pasada siguiente, no acá: así el envío pasa por el
  // mismo control (¿contestó?, ¿sigue activo el flujo?) sin importar si esperó
  // ocho horas o ninguna.
}

/** Reserva la racha solo para dejar escrito por qué no se mandó nada. */
async function reserveAndClose(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  conv: SilentConversationRow,
  anchor: string,
  now: Date,
  reason: string,
) {
  const { error } = await supabase.from("automation_executions").insert({
    flow_id: flow.id,
    conversation_id: conv.id,
    client_id: conv.client_id,
    silence_anchor_at: anchor,
    scheduled_for: now.toISOString(),
    executed_at: now.toISOString(),
    status: "skipped",
    error: reason.slice(0, 500),
  });

  if (error && error.code !== "23505") {
    console.error(
      `[automations] silence skip insert error for flow ${flow.id}:`,
      error.message,
    );
  }
}

type QueuedFollowUp = {
  id: string;
  silence_anchor_at: string;
  automation_flows: AutomationFlow | null;
  conversations:
    | {
        id: string;
        client_id: string | null;
        display_name: string | null;
        archived: boolean;
        last_inbound_at: string | null;
        clients: { full_name: string } | null;
      }
    | null;
};

/**
 * Manda los seguimientos que ya tienen la hora cumplida. A las 9 de la mañana
 * esto es lo que vacía de una todo lo que se juntó durante la noche.
 */
async function drainNoReplyQueue(
  supabase: SupabaseClient<Database>,
  now: Date,
) {
  const { data, error } = await supabase
    .from("automation_executions")
    .select(
      `id, silence_anchor_at,
       automation_flows ( * ),
       conversations ( id, client_id, display_name, archived, last_inbound_at, clients ( full_name ) )`,
    )
    .eq("status", "pending")
    .not("silence_anchor_at", "is", null)
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(NO_REPLY_BATCH);

  if (error) {
    console.error("[automations] no-reply queue read error:", error.message);
    return;
  }

  const rows = (data ?? []) as unknown as QueuedFollowUp[];
  if (rows.length === NO_REPLY_BATCH) {
    console.warn(
      `[automations] la cola de seguimientos venía con más de ${NO_REPLY_BATCH}; el resto sale en la vuelta siguiente.`,
    );
  }

  for (const row of rows) {
    try {
      await releaseFollowUp(supabase, row, now);
    } catch (err) {
      console.error(
        `[automations] no-reply release ${row.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function releaseFollowUp(
  supabase: SupabaseClient<Database>,
  row: QueuedFollowUp,
  now: Date,
) {
  const flow = row.automation_flows;
  const conv = row.conversations;

  if (!flow || !conv) {
    await closeExecution(
      supabase,
      row.id,
      "failed",
      "El flujo o el chat dejaron de existir mientras el mensaje esperaba.",
    );
    return;
  }

  // Todo lo que sigue pasó DESPUÉS de reservar el envío. Es el motivo de que
  // la cola exista: entre que se detecta el silencio y que se cumple la hora
  // pueden pasar horas, y en esas horas el envío puede quedar sin sentido.
  if (!flow.active) {
    await closeExecution(
      supabase,
      row.id,
      "skipped",
      "El flujo se desactivó mientras el mensaje esperaba la hora de envío.",
    );
    return;
  }

  if (conv.archived) {
    await closeExecution(
      supabase,
      row.id,
      "skipped",
      "El chat se archivó mientras el mensaje esperaba la hora de envío.",
    );
    return;
  }

  // La que importa: contestó. Mandarle igual un "¿pudiste verlo?" encima de su
  // respuesta es exactamente lo que el flujo no tiene que hacer.
  const anchorMs = new Date(row.silence_anchor_at).getTime();
  const inboundMs = conv.last_inbound_at
    ? new Date(conv.last_inbound_at).getTime()
    : null;
  if (inboundMs !== null && inboundMs > anchorMs) {
    await closeExecution(
      supabase,
      row.id,
      "skipped",
      "La clienta contestó antes de la hora de envío.",
    );
    return;
  }

  // Se vuelve a preguntar por los turnos porque entre la detección y la hora
  // de salida pueden haber pasado horas, y en el medio el salón pudo agendarle
  // el turno por teléfono: la venta se cerró aunque ella nunca contestó el chat.
  const sales = await isSalesStage(supabase, conv.client_id, now);
  if (!sales.ok) {
    await closeExecution(supabase, row.id, "skipped", sales.reason);
    return;
  }

  if (flow.send_mode !== "template") {
    const open =
      inboundMs !== null && now.getTime() - inboundMs < CLOUD_WINDOW_MS;
    if (!open) {
      await closeExecution(
        supabase,
        row.id,
        "skipped",
        "La ventana de 24 h se cerró mientras el mensaje esperaba. Para que un seguimiento salga a cualquier hora hace falta una plantilla aprobada.",
      );
      return;
    }
  }

  const fullName = conv.clients?.full_name ?? conv.display_name ?? "";
  const built = await buildFlowMessage(
    supabase,
    flow,
    conversationFlowContext(fullName, flow.review_salon_name),
  );

  if (!built.ok) {
    await closeExecution(supabase, row.id, "failed", built.error);
    console.error(
      `[automations] flow ${flow.name} sin mensaje que mandar:`,
      built.error,
    );
    return;
  }

  const queued = await queueFlowMessage(supabase, row.id, conv.id, built.content);
  if (!queued) return;

  if (!isWithinSendWindow(now)) {
    console.log(
      `⚡ automation "${flow.name}" → seguimiento fuera de horario para ${fullName || conv.id}: se cerraba la ventana de 24 h.`,
    );
    return;
  }

  console.log(
    `⚡ automation "${flow.name}" → seguimiento encolado para ${fullName || conv.id}`,
  );
}
