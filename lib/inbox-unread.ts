import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Cuántas conversaciones carga la bandeja. El globo del rail tiene que mirar
 * exactamente esta ventana: contar sobre toda la tabla traía 118 chats de
 * junio con el contador sin limpiar —invisibles en la lista, porque quedan
 * fuera de las 100 más recientes— y el globo marcaba "99+" con la bandeja
 * diciendo "1 sin leer".
 */
export const INBOX_LIMIT = 100;

/**
 * Chats sin leer de la bandeja: los globos verdes que se ven en la lista.
 *
 * Cuenta conversaciones, no mensajes. Es la cuenta que hace WhatsApp y la que
 * se busca de reojo: no importa que en un chat esperen veinte mensajes, sino
 * cuántas charlas hay sin abrir.
 *
 * Mismo orden y mismo límite que `app/(dashboard)/crm/page.tsx`, para que el
 * número del globo y el de la bandeja no puedan separarse.
 */
export async function countInboxUnread(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data } = await supabase
    .from("conversations")
    .select("unread_count")
    .eq("archived", false)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(INBOX_LIMIT);

  return (data ?? []).filter((row) => row.unread_count > 0).length;
}
