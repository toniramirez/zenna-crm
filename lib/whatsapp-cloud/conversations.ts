import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneDigits, phoneKey, WA_CLOUD_CHANNEL } from "@/lib/channels";
import type { Database } from "@/types/database.types";

type Db = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

export type ResolvedConversation =
  | { conversationId: string; created: boolean; error?: undefined }
  | { conversationId?: undefined; created?: undefined; error: string };

/**
 * Encuentra —o abre— el chat de una clienta en el número nuevo (Cloud API).
 *
 * Es el reemplazo de la vieja búsqueda contra el canal de Baileys, y ahora lo
 * usan tanto el turnero como las automatizaciones. El orden importa:
 *
 *   1. Por clienta vinculada, que es el dato más confiable.
 *   2. Por los últimos 8 dígitos del teléfono. El `external_id` del canal son
 *      los dígitos pelados del `wa_id` de Meta, y en Argentina Meta devuelve
 *      el número SIN el 9 del celular aunque la ficha lo tenga: comparar los
 *      números enteros abriría un chat nuevo por cada forma de escribirlos.
 *   3. Recién entonces se crea. Es el caso normal después de la migración —
 *      la clienta nunca escribió al número nuevo, así que su chat no existe.
 *
 * `createIfMissing: false` sirve para preguntar sin ensuciar la bandeja de
 * conversaciones vacías.
 */
export async function resolveCloudConversation(
  supabase: Db,
  args: {
    clientId?: string | null;
    phone?: string | null;
    displayName?: string | null;
    createIfMissing?: boolean;
  },
): Promise<ResolvedConversation> {
  if (args.clientId) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("channel", WA_CLOUD_CHANNEL)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { conversationId: existing.id, created: false };
  }

  const digits = phoneDigits(args.phone);
  if (!digits) {
    return {
      error: "La clienta no tiene un teléfono válido cargado en su ficha.",
    };
  }

  const last8 = phoneKey(digits);
  const { data: byPhone } = await supabase
    .from("conversations")
    .select("id, client_id")
    .eq("channel", WA_CLOUD_CHANNEL)
    .or(`external_id.ilike.%${last8}%,wa_phone.ilike.%${last8}%`)
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
    return { conversationId: byPhone.id, created: false };
  }

  if (args.createIfMissing === false) {
    return { error: "Todavía no hay chat con esta clienta en el número nuevo." };
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      channel: WA_CLOUD_CHANNEL,
      // En este canal el external_id ES el número: los mismos dígitos que
      // manda Meta como `wa_id`. Si la clienta después escribe, el webhook
      // cae sobre esta misma fila en vez de abrir una segunda.
      external_id: digits,
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

  if (created) return { conversationId: created.id, created: true };

  // 23505 = otro pedido creó la misma conversación entre medio (o ya existía
  // archivada, que la búsqueda de arriba no mira).
  if (error?.code === UNIQUE_VIOLATION) {
    const { data: raced } = await supabase
      .from("conversations")
      .select("id")
      .eq("channel", WA_CLOUD_CHANNEL)
      .eq("external_id", digits)
      .maybeSingle();
    if (raced) return { conversationId: raced.id, created: false };
  }

  console.error("[wa-cloud] resolveCloudConversation error:", error);
  return { error: "No pudimos abrir el chat de WhatsApp de la clienta." };
}
