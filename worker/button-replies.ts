import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buttonRepliesOf,
  matchButtonReply,
  type FlowButtonReply,
} from "@/lib/automations/buttons";
import { renderTemplate } from "@/lib/validations/crm-config";
import type { Database } from "@/types/database.types";
import {
  APPOINTMENT_SELECT,
  appointmentFlowContext,
  type AppointmentRow,
} from "./automations";

type Db = SupabaseClient<Database>;

type AutomationFlow = Database["public"]["Tables"]["automation_flows"]["Row"];

/** Código de violación de unique constraint en Postgres. */
const UNIQUE_VIOLATION = "23505";

export type ButtonClick = {
  conversationId: string;
  /** La fila entrante que ya quedó guardada para este click. */
  inboundMessageId: string;
  /** `context.id` del webhook: el wamid de la plantilla que llevaba el botón. */
  contextExternalId: string | null;
  /** Label y payload del botón, como los mandó Meta. */
  labels: Array<string | null | undefined>;
};

/**
 * Contesta el click de un botón de una plantilla que mandó un flujo.
 *
 * Devuelve `true` cuando consumió el mensaje, con el mismo criterio que la
 * encuesta de reseña: si el flujo ya contestó, el resto de los disparadores
 * de entrada no tienen que volver a contestar y encimar dos mensajes.
 *
 * El match va por `context.id` y no por el texto del botón: Meta manda en el
 * click el wamid del mensaje sobre el que se tocó, así que se puede llegar al
 * flujo exacto que lo originó. Buscar "la última plantilla de esta
 * conversación" contestaría mal apenas se manden dos flujos parecidos el
 * mismo día.
 *
 * Ojo con lo que NO hace falta acá: la respuesta se encola como mensaje
 * común, sin plantilla. El click abrió la ventana de 24 h de la Cloud API —
 * es un mensaje de la clienta como cualquier otro— así que a partir de ahora
 * se puede mandar texto libre, una imagen o un video.
 */
export async function processInboundButtonReply(
  supabase: Db,
  click: ButtonClick,
): Promise<boolean> {
  if (!click.contextExternalId) return false;
  if (!click.labels.some((l) => l && l.trim().length > 0)) return false;

  // 1. La plantilla sobre la que tocaron, dentro de este mismo chat. El filtro
  //    por conversación evita que un wamid repetido de otro chat matchee.
  const { data: source } = await supabase
    .from("messages")
    .select("id")
    .eq("external_id", click.contextExternalId)
    .eq("conversation_id", click.conversationId)
    .eq("direction", "outbound")
    .maybeSingle();
  if (!source) return false;

  // 2. ¿La mandó un flujo? Los envíos a mano desde la bandeja no tienen
  //    ejecución, y por ahora no tienen respuesta automática configurable.
  const { data: execution } = await supabase
    .from("automation_executions")
    .select("id, appointment_id, automation_flows ( * )")
    .eq("message_id", source.id)
    .limit(1)
    .maybeSingle();
  if (!execution) return false;

  const flow = (execution as unknown as { automation_flows: AutomationFlow | null })
    .automation_flows;
  if (!flow || !flow.active) return false;

  const reply = matchButtonReply(buttonRepliesOf(flow.button_replies), click.labels);
  if (!reply) return false;

  const buttonText =
    click.labels.find((l): l is string => Boolean(l && l.trim())) ?? reply.button;

  // 3. Reclamar el click. El único sobre `inbound_message_id` es lo que hace
  //    que un reintento del hook de entrada no conteste dos veces.
  const { data: event, error: eventErr } = await supabase
    .from("automation_button_events")
    .insert({
      flow_id: flow.id,
      conversation_id: click.conversationId,
      inbound_message_id: click.inboundMessageId,
      source_message_id: source.id,
      button_text: buttonText.slice(0, 200),
    })
    .select("id")
    .single();

  if (eventErr || !event) {
    if (eventErr?.code === UNIQUE_VIOLATION) return true; // ya contestado
    console.error(
      `[buttons] no pudimos registrar el click del flujo ${flow.id}:`,
      eventErr?.message,
    );
    return false;
  }

  // 4. Las variables del CRM. Si el flujo salió por un turno, la respuesta
  //    puede repetir fecha y hora; si salió por un mensaje entrante, solo hay
  //    nombre y las demás quedan vacías.
  const ctx = await replyContext(supabase, {
    conversationId: click.conversationId,
    appointmentId: execution.appointment_id,
    salonName: flow.review_salon_name,
  });

  const messageId = await enqueueReply(supabase, {
    conversationId: click.conversationId,
    reply,
    ctx,
  });

  if (!messageId.ok) {
    await supabase
      .from("automation_button_events")
      .update({ error: messageId.error.slice(0, 500) })
      .eq("id", event.id);
    console.error(
      `[buttons] no pudimos contestar el botón "${buttonText}" del flujo ${flow.name}:`,
      messageId.error,
    );
    // Consumido igual: el click quedó registrado y reintentar mandaría dos.
    return true;
  }

  await supabase
    .from("automation_button_events")
    .update({ reply_message_id: messageId.id })
    .eq("id", event.id);

  console.log(
    `⚡ botón "${buttonText}" del flujo "${flow.name}" → respuesta encolada`,
  );
  return true;
}

/**
 * El contexto con el que se resuelven las `{{variables}}` de la respuesta.
 *
 * El turno es la fuente buena cuando existe: es el mismo que usó el mensaje
 * que llevaba el botón. Sin turno (flujos de mensaje entrante) queda el
 * nombre de la clienta, que es lo único que se sabe.
 */
async function replyContext(
  supabase: Db,
  args: {
    conversationId: string;
    appointmentId: string | null;
    salonName: string | null;
  },
): Promise<Record<string, string>> {
  if (args.appointmentId) {
    const { data } = await supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .eq("id", args.appointmentId)
      .maybeSingle();
    if (data) {
      return appointmentFlowContext(
        data as unknown as AppointmentRow,
        args.salonName,
      );
    }
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("display_name, clients ( full_name )")
    .eq("id", args.conversationId)
    .maybeSingle();

  const fullName =
    (conv as unknown as { clients: { full_name: string } | null } | null)?.clients
      ?.full_name ??
    conv?.display_name ??
    "";

  return {
    nombre: fullName.split(" ")[0] ?? "",
    servicio: "",
    fecha: "",
    hora: "",
    profesional: "",
    salon: args.salonName ?? "",
  };
}

/**
 * Encola la respuesta como un mensaje de salida más: el poller de la Cloud
 * API la levanta igual que a lo que escribe la recepción.
 *
 * Con archivo va un solo mensaje —la media con el texto de epígrafe— y no dos
 * burbujas: es como se ve mejor del lado de la clienta y es lo que la Cloud
 * API permite en una sola llamada.
 */
async function enqueueReply(
  supabase: Db,
  args: {
    conversationId: string;
    reply: FlowButtonReply;
    ctx: Record<string, string>;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body = renderTemplate(args.reply.body, args.ctx).trim();
  const hasMedia = Boolean(args.reply.media_url && args.reply.media_type);

  if (!hasMedia && body.length === 0) {
    return { ok: false, error: "La respuesta quedó vacía." };
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: args.conversationId,
      direction: "outbound",
      type: hasMedia ? args.reply.media_type! : "text",
      body: body.length > 0 ? body : null,
      media_url: hasMedia ? args.reply.media_url : null,
      media_mime: hasMedia ? args.reply.media_mime : null,
      media_filename: hasMedia ? args.reply.media_filename : null,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert sin filas" };
  }
  return { ok: true, id: data.id };
}
