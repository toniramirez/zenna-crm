import type { SupabaseClient } from "@supabase/supabase-js";
import {
  expectsFeedback,
  opensCase,
  parseReviewScore,
  REVIEW_ANSWER_WINDOW_MINUTES,
  REVIEW_FEEDBACK_WINDOW_MINUTES,
  reviewBucket,
} from "@/lib/reviews";
import { buildFlowMessage } from "@/lib/automations/message";
import { renderTemplate } from "@/lib/validations/crm-config";
import { resolveCloudConversation } from "@/lib/whatsapp-cloud/conversations";
import type { Database } from "@/types/database.types";

type AutomationFlow = Database["public"]["Tables"]["automation_flows"]["Row"];

type ReviewAppointment = {
  id: string;
  client_id: string;
  clients: { full_name: string; phone?: string | null } | null;
  professionals: { full_name: string } | null;
  appointment_services: { services: { name: string } | null }[];
};

/**
 * El lado "salida" del flujo de reseña: manda la pregunta del 1 al 5 cuando
 * el turno se cobró hace `trigger_offset_minutes`.
 *
 * A diferencia de un flujo común no deja rastro en `automation_executions`
 * sino en `review_requests`, porque la pregunta abre una conversación que hay
 * que seguir: el puntaje que conteste la clienta vuelve a esa misma fila. El
 * único (flow_id, appointment_id) es lo que impide que dos ticks solapados
 * pregunten dos veces.
 */
export async function fireReviewForAppointment(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  apt: ReviewAppointment,
) {
  // Igual que las automatizaciones comunes: sale por el número nuevo (Cloud
  // API) y nunca por Instagram ni por el número viejo. La encuesta se manda
  // horas después de cobrar el turno, así que casi siempre cae FUERA de la
  // ventana de 24 h: para que llegue, el flujo tiene que estar en modo
  // plantilla. En modo texto libre solo alcanza a quien escribió hace poco, y
  // por eso ahí no se abre un chat que no exista.
  const wantsTemplate = flow.send_mode === "template";
  const resolved = await resolveCloudConversation(supabase, {
    clientId: apt.client_id,
    phone: apt.clients?.phone ?? null,
    displayName: apt.clients?.full_name ?? null,
    createIfMissing: wantsTemplate,
  });
  const conversationId = resolved.conversationId;
  if (!conversationId) return;

  const { data: request, error: reqErr } = await supabase
    .from("review_requests")
    .insert({
      flow_id: flow.id,
      appointment_id: apt.id,
      client_id: apt.client_id,
      conversation_id: conversationId,
    })
    .select("id")
    .single();

  if (reqErr || !request) {
    // 23505 = ya se preguntó en un tick anterior. Esperado, se traga.
    if (reqErr?.code !== "23505") {
      console.error(
        `[reviews] no pudimos abrir la encuesta del flujo ${flow.id}:`,
        reqErr?.message,
      );
    }
    return;
  }

  const services = apt.appointment_services
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");

  const built = await buildFlowMessage(supabase, flow, {
    nombre: apt.clients?.full_name?.split(" ")[0] ?? "",
    salon: flow.review_salon_name ?? "",
    servicio: services || "tu turno",
    profesional: apt.professionals?.full_name ?? "",
    link: flow.review_google_url ?? "",
    fecha: "",
    hora: "",
  });

  if (!built.ok) {
    // Sin pregunta no hay encuesta: se borra la fila para que el próximo tick
    // lo reintente cuando la plantilla vuelva a estar aprobada.
    await supabase.from("review_requests").delete().eq("id", request.id);
    console.error(
      `[reviews] no pudimos armar la pregunta del flujo ${flow.id}:`,
      built.error,
    );
    return;
  }

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
    // Sin pregunta enviada la fila no sirve para nada y encima bloquearía el
    // reintento por el único: se borra para que el próximo tick lo intente.
    await supabase.from("review_requests").delete().eq("id", request.id);
    console.error(
      `[reviews] no pudimos encolar la pregunta del flujo ${flow.id}:`,
      msgErr?.message,
    );
    return;
  }

  await supabase
    .from("review_requests")
    .update({ question_message_id: msg.id })
    .eq("id", request.id);

  console.log(
    `⭐ reseña "${flow.name}" → pregunta encolada para ${apt.clients?.full_name ?? apt.client_id}`,
  );
}

/**
 * El lado "entrada": mira si el mensaje que acaba de llegar es la respuesta a
 * una encuesta abierta y, si lo es, contesta según el puntaje.
 *
 * Devuelve `true` cuando consumió el mensaje. El worker usa ese valor para NO
 * seguir con las automatizaciones de mensaje entrante: sin eso, un "5" podría
 * disparar además el saludo de reactivación y la clienta recibiría dos
 * respuestas encimadas.
 *
 * Guardar el texto libre posterior (el "¿qué pasó?") NO consume el mensaje:
 * es una anotación al caso, no una respuesta, y el salón sigue viéndolo en el
 * chat como cualquier otro.
 */
export async function processInboundReview(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  body: string | null,
  sentAt: Date,
): Promise<boolean> {
  if (!body || body.trim().length === 0) return false;

  const answerCutoff = new Date(
    sentAt.getTime() - REVIEW_ANSWER_WINDOW_MINUTES * 60_000,
  );

  const { data: pending } = await supabase
    .from("review_requests")
    .select("id, flow_id, client_id, automation_flows ( * )")
    .eq("conversation_id", conversationId)
    .is("score", null)
    .gte("asked_at", answerCutoff.toISOString())
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    const score = parseReviewScore(body);
    // Sin puntaje reconocible el mensaje no era para nosotros: la encuesta
    // sigue abierta (por si contesta el número después) y el mensaje sigue su
    // curso normal.
    if (score === null) return false;

    const flow = (pending as unknown as {
      automation_flows: AutomationFlow | null;
    }).automation_flows;
    if (!flow) return false;

    await answerReview(
      supabase,
      flow,
      pending.id,
      conversationId,
      score,
      sentAt,
    );
    return true;
  }

  // No hay encuesta abierta: puede ser el texto que sigue a un puntaje bajo,
  // que es justo lo que el caso interno necesita para ser útil.
  await captureFeedback(supabase, conversationId, body, sentAt);
  return false;
}

async function answerReview(
  supabase: SupabaseClient<Database>,
  flow: AutomationFlow,
  requestId: string,
  conversationId: string,
  score: number,
  sentAt: Date,
) {
  const bucket = reviewBucket(score);
  const template =
    bucket === "high"
      ? flow.review_reply_high
      : bucket === "mid"
        ? flow.review_reply_mid
        : flow.review_reply_low;

  await supabase
    .from("review_requests")
    .update({
      score,
      answered_at: sentAt.toISOString(),
      case_status: opensCase(score) ? "open" : "none",
    })
    .eq("id", requestId);

  if (!template) {
    console.error(
      `[reviews] el flujo ${flow.id} no tiene respuesta para un ${score}.`,
    );
    return;
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("display_name, clients ( full_name )")
    .eq("id", conversationId)
    .maybeSingle();

  const fullName =
    (conv as unknown as { clients: { full_name: string } | null } | null)
      ?.clients?.full_name ??
    conv?.display_name ??
    "";

  const body = renderTemplate(template, {
    nombre: fullName.split(" ")[0] ?? "",
    salon: flow.review_salon_name ?? "",
    link: flow.review_google_url ?? "",
    servicio: "",
    profesional: "",
    fecha: "",
    hora: "",
  });

  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      type: "text",
      body,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    console.error(
      `[reviews] no pudimos encolar la respuesta al ${score}:`,
      msgErr?.message,
    );
    return;
  }

  await supabase
    .from("review_requests")
    .update({ reply_message_id: msg.id })
    .eq("id", requestId);

  console.log(
    `⭐ reseña "${flow.name}" → ${fullName || conversationId} puntuó ${score}${
      opensCase(score) ? " (caso abierto)" : ""
    }`,
  );
}

/**
 * Pega el primer mensaje que llega después de un puntaje mejorable al caso,
 * que es la respuesta al "¿nos contarías qué pasó?". Solo el primero: a partir
 * del segundo ya es conversación normal y la atiende una persona.
 */
async function captureFeedback(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  body: string,
  sentAt: Date,
) {
  const cutoff = new Date(
    sentAt.getTime() - REVIEW_FEEDBACK_WINDOW_MINUTES * 60_000,
  );

  const { data: answered } = await supabase
    .from("review_requests")
    .select("id, score")
    .eq("conversation_id", conversationId)
    .not("score", "is", null)
    .is("feedback", null)
    .gte("answered_at", cutoff.toISOString())
    .order("answered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!answered?.score || !expectsFeedback(answered.score)) return;

  await supabase
    .from("review_requests")
    .update({
      feedback: body.slice(0, 4000),
      feedback_at: sentAt.toISOString(),
    })
    .eq("id", answered.id);
}
