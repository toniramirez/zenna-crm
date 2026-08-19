"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildTemplatePayload,
  componentsOf,
  renderTemplatePreview,
  templateSendability,
  type TemplateVariableValues,
} from "@/lib/whatsapp-cloud/templates";
import type { Database, Json } from "@/types/database.types";

export type ActionState = {
  error?: string;
  success?: boolean;
};

export async function sendMessageAction(
  conversationId: string,
  body: string,
): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const text = body.trim();
  if (text.length === 0) return { error: "El mensaje está vacío." };
  if (text.length > 4000) return { error: "El mensaje es demasiado largo." };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    type: "text",
    body: text,
    status: "queued",
    sent_by: ctx.userId,
  });

  if (error) {
    console.error("[crm] sendMessage error:", error);
    return { error: "No pudimos encolar el mensaje." };
  }

  revalidatePath("/crm");
  return { success: true };
}

type MediaType = Database["public"]["Enums"]["message_type"];

/**
 * Insert an outbound media message. The caller (browser) has already
 * uploaded the file to Storage at `outbound/<conv>/<id>.<ext>` and passes
 * the resulting path. The worker will download from Storage and forward
 * via Baileys.
 */
export async function sendMediaMessageAction(args: {
  conversationId: string;
  type: MediaType;
  mediaPath: string;
  mediaMime: string;
  mediaFilename?: string | null;
  caption?: string | null;
}): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  if (!["image", "video", "audio", "document", "sticker"].includes(args.type)) {
    return { error: "Tipo de media no soportado." };
  }
  if (!args.mediaPath.startsWith("outbound/")) {
    return { error: "Ruta de media inválida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    direction: "outbound",
    type: args.type,
    body: args.caption?.trim() || null,
    media_url: args.mediaPath,
    media_mime: args.mediaMime,
    media_filename: args.mediaFilename || null,
    status: "queued",
    sent_by: ctx.userId,
  });

  if (error) {
    console.error("[crm] sendMedia error:", error);
    return { error: "No pudimos encolar el archivo." };
  }

  revalidatePath("/crm");
  return { success: true };
}

/**
 * Insert an outbound reaction. The worker will pick it up and call
 * sock.sendMessage(jid, { react: {...} }) referencing the target message.
 * Pass empty string for `emoji` to remove a previous reaction.
 */
export async function sendReactionAction(args: {
  conversationId: string;
  targetExternalId: string;
  emoji: string;
}): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);
  const emoji = args.emoji.trim();
  if (emoji.length > 8) return { error: "Emoji inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    direction: "outbound",
    type: "reaction",
    body: emoji,
    reaction_target_external_id: args.targetExternalId,
    status: "queued",
    sent_by: ctx.userId,
  });

  if (error) {
    console.error("[crm] sendReaction error:", error);
    return { error: "No pudimos enviar la reacción." };
  }

  return { success: true };
}

/**
 * Encola una plantilla aprobada de la Cloud API (canal `whatsapp_cloud`).
 *
 * La fila queda como un texto normal —`body` es la vista previa renderizada,
 * que es lo que muestra la burbuja— más `wa_template`, el payload que el
 * worker manda tal cual a Meta. Es el único tipo de mensaje que Meta acepta
 * fuera de la ventana de 24 h, así que no se chequea ventana acá.
 */
export async function sendTemplateMessageAction(args: {
  conversationId: string;
  templateId: string;
  values: TemplateVariableValues;
}): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, channel")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (!conversation) return { error: "No encontramos la conversación." };
  if (conversation.channel !== "whatsapp_cloud") {
    return { error: "Las plantillas solo van por el canal de WhatsApp API." };
  }

  const { data: template } = await supabase
    .from("whatsapp_templates")
    .select("*")
    .eq("id", args.templateId)
    .maybeSingle();
  if (!template) return { error: "No encontramos la plantilla." };
  if (template.status.toUpperCase() !== "APPROVED") {
    return { error: "Esa plantilla no está aprobada por Meta." };
  }

  const components = componentsOf(template);
  const sendable = templateSendability(components, template.category);
  if (!sendable.ok) return { error: sendable.reason };

  // Meta rechaza parámetros con saltos de línea, tabs o más de 4 espacios
  // seguidos (error 132000): se normaliza todo el espacio en blanco.
  const clean = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.replace(/\s+/g, " ").trim()]),
    );
  const values: TemplateVariableValues = {
    header: clean(args.values.header ?? {}),
    body: clean(args.values.body ?? {}),
  };

  let payload;
  try {
    payload = buildTemplatePayload({
      name: template.name,
      language: template.language,
      components,
      values,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    direction: "outbound",
    type: "text",
    body: renderTemplatePreview(components, values),
    wa_template: payload as unknown as Json,
    status: "queued",
    sent_by: ctx.userId,
  });

  if (error) {
    console.error("[crm] sendTemplate error:", error);
    return { error: "No pudimos encolar la plantilla." };
  }

  revalidatePath("/crm");
  return { success: true };
}

/**
 * Ventana de edición de WhatsApp: pasados 15 minutos el servidor rechaza el
 * `edit` y el mensaje queda como estaba. La chequeamos de este lado para no
 * encolar una operación que ya sabemos que va a fallar.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Tope de chats a los que WhatsApp deja reenviar de una. */
const MAX_FORWARD_TARGETS = 5;

type MessageForAction = {
  id: string;
  conversation_id: string;
  direction: Database["public"]["Enums"]["message_direction"];
  type: Database["public"]["Enums"]["message_type"];
  status: Database["public"]["Enums"]["message_status"];
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  external_id: string | null;
  sent_at: string;
  revoked_at: string | null;
  conversations: { channel: string } | null;
};

/**
 * Edita un mensaje ya enviado, igual que WhatsApp: cambia el texto para las
 * dos partes y deja el sello "editado".
 *
 * El texto nuevo se guarda en el acto y la propagación a WhatsApp va por la
 * cola de `message_ops`. Es el mismo orden que usa WhatsApp Web —la burbuja
 * cambia mientras el mensaje viaja—, y así la bandeja no se queda dos
 * segundos mostrando lo viejo.
 */
export async function editMessageAction(
  messageId: string,
  newBody: string,
): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const text = newBody.trim();
  if (text.length === 0) return { error: "El mensaje está vacío." };
  if (text.length > 4000) return { error: "El mensaje es demasiado largo." };

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, direction, type, status, body, media_url, media_mime, media_filename, external_id, sent_at, revoked_at, conversations(channel)",
    )
    .eq("id", messageId)
    .maybeSingle<MessageForAction>();

  if (!message) return { error: "No encontramos el mensaje." };
  if (message.direction !== "outbound") {
    return { error: "Solo se pueden editar los mensajes que mandaste vos." };
  }
  if (message.revoked_at) return { error: "El mensaje ya está eliminado." };
  if (message.type !== "text") {
    return { error: "WhatsApp solo deja editar mensajes de texto." };
  }
  if (message.conversations?.channel !== "whatsapp") {
    return { error: "Editar mensajes solo funciona en WhatsApp." };
  }
  if (!message.external_id) {
    return { error: "Esperá a que el mensaje salga para poder editarlo." };
  }
  if (Date.now() - new Date(message.sent_at).getTime() > EDIT_WINDOW_MS) {
    return { error: "Pasaron más de 15 minutos: WhatsApp ya no deja editarlo." };
  }
  if (text === message.body) return { success: true };

  const { error: opError } = await supabase.from("message_ops").insert({
    message_id: message.id,
    conversation_id: message.conversation_id,
    op: "edit",
    body: text,
    created_by: ctx.userId,
  });
  if (opError) {
    console.error("[crm] editMessage op error:", opError);
    return { error: "No pudimos encolar la edición." };
  }

  const { error: patchError } = await supabase
    .from("messages")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("id", message.id);
  if (patchError) {
    console.error("[crm] editMessage patch error:", patchError);
    return { error: "No pudimos guardar el texto editado." };
  }

  revalidatePath("/crm");
  return { success: true };
}

/**
 * "Cancelar envío" / "Eliminar para todos", que en WhatsApp es el mismo gesto
 * con dos finales según si el mensaje llegó a salir:
 *
 *   - todavía en la cola → se marca eliminado y el worker no lo manda nunca.
 *     Funciona aunque WhatsApp esté desconectado, que es justo cuando se
 *     acumulan mensajes sin salir y alguien se arrepiente.
 *   - ya enviado → se marca eliminado acá y se encola el `revoke` que lo borra
 *     también del teléfono de la clienta.
 */
export async function deleteMessageAction(
  messageId: string,
): Promise<ActionState & { cancelled?: boolean }> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, direction, type, status, body, media_url, media_mime, media_filename, external_id, sent_at, revoked_at, conversations(channel)",
    )
    .eq("id", messageId)
    .maybeSingle<MessageForAction>();

  if (!message) return { error: "No encontramos el mensaje." };
  if (message.direction !== "outbound") {
    return { error: "Solo se pueden eliminar los mensajes que mandaste vos." };
  }
  if (message.revoked_at) return { success: true, cancelled: true };

  // Sin external_id nunca salió: alcanza con marcarlo, no hay nada que borrar
  // del otro lado.
  const alreadySent = !!message.external_id;

  // En la Cloud API no existe el revoke: si el worker ya lo está mandando,
  // cancelar acá solo taparía en la bandeja un mensaje que la clienta va a
  // recibir igual. En Baileys sí se permite — el worker manda el `delete`
  // remoto si el envío se le adelantó.
  if (
    !alreadySent &&
    message.conversations?.channel === "whatsapp_cloud" &&
    message.status === "sending"
  ) {
    return { error: "El mensaje ya se está enviando: no llegamos a cancelarlo." };
  }

  if (alreadySent) {
    if (message.conversations?.channel !== "whatsapp") {
      return { error: "Eliminar para todos solo funciona en WhatsApp." };
    }
    const { error: opError } = await supabase.from("message_ops").insert({
      message_id: message.id,
      conversation_id: message.conversation_id,
      op: "revoke",
      created_by: ctx.userId,
    });
    if (opError) {
      console.error("[crm] deleteMessage op error:", opError);
      return { error: "No pudimos encolar la eliminación." };
    }
  }

  const { error: patchError } = await supabase
    .from("messages")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", message.id);
  if (patchError) {
    console.error("[crm] deleteMessage patch error:", patchError);
    return { error: "No pudimos eliminar el mensaje." };
  }

  revalidatePath("/crm");
  return { success: true, cancelled: !alreadySent };
}

/**
 * Reenvía un mensaje a otros chats. No usa el `forward` de WhatsApp —que pide
 * el mensaje original crudo, y de los entrantes no lo guardamos— sino que
 * encola una copia: el texto tal cual, o el mismo archivo del bucket. Para la
 * clienta el resultado es idéntico, con el sello "Reenviado" incluido.
 */
export async function forwardMessageAction(
  messageId: string,
  targetConversationIds: string[],
): Promise<ActionState & { sent?: number }> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const targets = Array.from(new Set(targetConversationIds.filter(Boolean)));
  if (targets.length === 0) return { error: "Elegí al menos un chat." };
  if (targets.length > MAX_FORWARD_TARGETS) {
    return { error: `Podés reenviar a ${MAX_FORWARD_TARGETS} chats por vez.` };
  }

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, direction, type, status, body, media_url, media_mime, media_filename, external_id, sent_at, revoked_at, conversations(channel)",
    )
    .eq("id", messageId)
    .maybeSingle<MessageForAction>();

  if (!message) return { error: "No encontramos el mensaje." };
  if (message.revoked_at) return { error: "Ese mensaje está eliminado." };
  if (message.type === "reaction") {
    return { error: "Una reacción no se puede reenviar." };
  }
  if (message.type !== "text" && !message.media_url) {
    return { error: "Ese mensaje no tiene contenido para reenviar." };
  }
  if (message.type === "text" && !message.body?.trim()) {
    return { error: "Ese mensaje no tiene contenido para reenviar." };
  }

  const rows = targets.map((conversationId) => ({
    conversation_id: conversationId,
    direction: "outbound" as const,
    type: message.type,
    body: message.body,
    media_url: message.media_url,
    media_mime: message.media_mime,
    media_filename: message.media_filename,
    forwarded: true,
    status: "queued" as const,
    sent_by: ctx.userId,
  }));

  const { error } = await supabase.from("messages").insert(rows);
  if (error) {
    console.error("[crm] forwardMessage error:", error);
    return { error: "No pudimos reenviar el mensaje." };
  }

  revalidatePath("/crm");
  return { success: true, sent: rows.length };
}

/** Fija o desfija un chat arriba de la lista. */
export async function togglePinConversationAction(
  conversationId: string,
  pinned: boolean,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", conversationId);

  if (error) {
    console.error("[crm] togglePin error:", error);
    return { error: "No pudimos fijar el chat." };
  }

  revalidatePath("/crm");
  return { success: true };
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  );
}

function jidToPhone(
  jid: string,
  waPhone?: string | null,
): string | null {
  // For LID JIDs we can't decode the phone from the JID itself — fall back to
  // the value the worker captured from msg.key.senderPn.
  if (jid.endsWith("@lid")) {
    const d = (waPhone ?? "").replace(/\D/g, "");
    return d.length >= 8 ? `+${d}` : null;
  }
  const digits = jid.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!digits || digits.length < 8) {
    const fallback = (waPhone ?? "").replace(/\D/g, "");
    return fallback.length >= 8 ? `+${fallback}` : null;
  }
  return `+${digits}`;
}

export async function setClientTagsAction(
  clientId: string,
  tags: string[],
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const normalized = normalizeTags(tags);

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ tags: normalized })
    .eq("id", clientId);

  if (error) {
    console.error("[crm] setClientTags error:", error);
    return { error: "No pudimos actualizar las etiquetas." };
  }

  revalidatePath("/crm");
  return { success: true };
}

/**
 * Tag from within a chat. If the conversation already has a linked client,
 * just updates the tag list. If not, creates a client on the fly using the
 * WhatsApp display name + phone, links the conversation, and applies the
 * tags. Returns the resolved client so the caller can patch local state.
 */
export async function setConversationTagsAction(
  conversationId: string,
  tags: string[],
): Promise<
  ActionState & { client?: { id: string; full_name: string; phone: string | null } }
> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, client_id, external_id, display_name, wa_phone")
    .eq("id", conversationId)
    .single();

  if (convErr || !conv) return { error: "Conversación no encontrada." };

  const normalized = normalizeTags(tags);

  if (conv.client_id) {
    const { data: client, error: updErr } = await supabase
      .from("clients")
      .update({ tags: normalized })
      .eq("id", conv.client_id)
      .select("id, full_name, phone")
      .single();
    if (updErr || !client) {
      console.error("[crm] setConversationTags update error:", updErr);
      return { error: "No pudimos actualizar las etiquetas." };
    }
    revalidatePath("/crm");
    return { success: true, client };
  }

  // No linked client → create one from the conversation context.
  const phone = jidToPhone(conv.external_id, conv.wa_phone);
  const fallbackName =
    conv.display_name?.trim() || phone || "Contacto sin nombre";

  const { data: created, error: createErr } = await supabase
    .from("clients")
    .insert({ full_name: fallbackName, phone, tags: normalized })
    .select("id, full_name, phone")
    .single();

  if (createErr || !created) {
    console.error("[crm] setConversationTags create error:", createErr);
    return { error: "No pudimos crear la clienta." };
  }

  const { error: linkErr } = await supabase
    .from("conversations")
    .update({ client_id: created.id })
    .eq("id", conversationId);

  if (linkErr) {
    // Client exists but conversation isn't linked. Not fatal — next message
    // arrival will retry the auto-link path in the worker.
    console.error("[crm] setConversationTags link error:", linkErr);
  }

  revalidatePath("/crm");
  return { success: true, client: created };
}

export async function markConversationReadAction(
  conversationId: string,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);

  if (error) return { error: "No pudimos marcar como leído." };
  return { success: true };
}

/**
 * Dígitos de un teléfono guardado en la ficha de la clienta. Los formatos
 * conviven ("+54 9 351 123-4567", "3511234567", …) porque el campo es libre.
 */
function phoneDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * Encuentra —o abre— el chat de WhatsApp de una clienta.
 *
 * Primero busca por la clienta vinculada, después por los últimos 8 dígitos
 * del teléfono (que es el criterio con el que el worker asocia contactos: el
 * prefijo internacional y el 9 de los celulares argentinos se escriben de mil
 * maneras). Recién si no hay nada abre una conversación nueva con el JID
 * armado a mano, que es lo que pasa cuando el salón escribe primero.
 */
async function resolveWhatsappConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { clientId?: string | null; phone?: string | null; displayName?: string | null },
): Promise<{ conversationId?: string; error?: string }> {
  if (args.clientId) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("channel", "whatsapp")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { conversationId: existing.id };
  }

  const digits = phoneDigits(args.phone);
  if (!digits) {
    return {
      error: "La clienta no tiene un teléfono válido cargado en su ficha.",
    };
  }

  const last8 = digits.slice(-8);
  const { data: byPhone } = await supabase
    .from("conversations")
    .select("id, client_id")
    .eq("channel", "whatsapp")
    .or(`wa_phone.ilike.%${last8}%,external_id.ilike.%${last8}%`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (byPhone) {
    // De paso queda vinculada: la próxima vez la encontramos por client_id y
    // el chat empieza a mostrar el nombre en vez del número.
    if (args.clientId && !byPhone.client_id) {
      await supabase
        .from("conversations")
        .update({ client_id: args.clientId })
        .eq("id", byPhone.id);
    }
    return { conversationId: byPhone.id };
  }

  const externalId = `${digits}@s.whatsapp.net`;
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      channel: "whatsapp",
      external_id: externalId,
      client_id: args.clientId ?? null,
      display_name: args.displayName ?? null,
      wa_phone: digits,
      // Un chat recién abierto va arriba de la lista aunque todavía no tenga
      // mensajes: si no, queda al final de las 100 que carga la bandeja y no
      // hay forma de encontrarlo.
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (created) return { conversationId: created.id };

  // 23505 = otro pedido creó la misma conversación entre medio (o ya existía
  // archivada, que la búsqueda de arriba no mira).
  if (error?.code === "23505") {
    const { data: raced } = await supabase
      .from("conversations")
      .select("id")
      .eq("channel", "whatsapp")
      .eq("external_id", externalId)
      .maybeSingle();
    if (raced) return { conversationId: raced.id };
  }

  console.error("[crm] resolveWhatsappConversation error:", error);
  return { error: "No pudimos abrir el chat de WhatsApp de la clienta." };
}

/**
 * Manda un WhatsApp a una clienta desde afuera de la bandeja (hoy, desde el
 * turnero). Si nunca hubo chat con ella, lo abre.
 */
export async function messageClientAction(args: {
  clientId?: string | null;
  phone?: string | null;
  displayName?: string | null;
  body: string;
}): Promise<ActionState & { conversationId?: string }> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const text = args.body.trim();
  if (text.length === 0) return { error: "El mensaje está vacío." };
  if (text.length > 4000) return { error: "El mensaje es demasiado largo." };

  const supabase = await createClient();
  const resolved = await resolveWhatsappConversation(supabase, args);
  if (!resolved.conversationId) return { error: resolved.error };

  const { error } = await supabase.from("messages").insert({
    conversation_id: resolved.conversationId,
    direction: "outbound",
    type: "text",
    body: text,
    status: "queued",
    sent_by: ctx.userId,
  });

  if (error) {
    console.error("[crm] messageClient error:", error);
    return { error: "No pudimos encolar el mensaje." };
  }

  revalidatePath("/crm");
  return { success: true, conversationId: resolved.conversationId };
}

/**
 * Igual que la anterior pero sin mandar nada: resuelve el chat para poder
 * abrirlo en la bandeja ("Abrir chat" desde el turnero).
 */
export async function openClientConversationAction(args: {
  clientId?: string | null;
  phone?: string | null;
  displayName?: string | null;
}): Promise<ActionState & { conversationId?: string }> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const resolved = await resolveWhatsappConversation(supabase, args);
  if (!resolved.conversationId) return { error: resolved.error };
  return { success: true, conversationId: resolved.conversationId };
}

/**
 * Associate a conversation with an existing client. Used when the
 * receptionist creates a new client from the chat-side turno dialog and
 * we want the conversation to start showing the proper name/avatar.
 */
export async function linkConversationClientAction(
  conversationId: string,
  clientId: string,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ client_id: clientId })
    .eq("id", conversationId);

  if (error) {
    console.error("[crm] linkConversationClient error:", error);
    return { error: "No pudimos vincular la clienta a la conversación." };
  }

  revalidatePath("/crm");
  return { success: true };
}
