"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

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
