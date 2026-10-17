import type { SupabaseClient } from "@supabase/supabase-js";
import type { WASocket } from "@whiskeysockets/baileys";
import { phoneDigits, WA_CLOUD_CHANNEL } from "@/lib/channels";
import type { Database } from "@/types/database.types";
import { storeProfilePicture } from "./media";

/**
 * Las fotos de perfil de la bandeja principal, sacadas con el número viejo.
 *
 * La Cloud API no da la foto de quien escribe: el webhook trae el nombre del
 * perfil y nada más. WhatsApp sí se la muestra a cualquier cuenta con sesión
 * abierta que tenga permiso de verla, así que el número viejo —que sigue
 * conectado por Baileys— la pide por los chats del número nuevo.
 *
 * Que la vea depende de la privacidad de cada clienta: con "Todos" sale
 * siempre; con "Mis contactos" solo si tiene agendado el número viejo (por
 * eso rinde más que un número cualquiera); con "Nadie", nunca.
 *
 * Cada chat se revisa como mucho una vez por semana, y solo si la clienta
 * escribió en esa semana (`avatar_checked_at`). Así una foto privada no se
 * vuelve a pedir en cada mensaje, y una que cambió se actualiza la próxima
 * vez que escriba. La primera pasada recorre todos los chats que alguna vez
 * escribieron, del más reciente al más viejo.
 *
 * Va de a poco a propósito: un número que consulta en ráfaga a gente con la
 * que nunca habló se parece a un bot, y este número no se puede perder.
 */

/** Cada cuánto se vuelve a mirar la foto de un chat que sigue escribiendo. */
const RECHECK_MS = 7 * 24 * 60 * 60_000;
/**
 * Chats por vuelta, y la pausa entre uno y otro. Con una vuelta cada 15 s son
 * unas 12 consultas por minuto: la primera pasada (≈570 chats en octubre de
 * 2026) tarda tres cuartos de hora, y la bandeja visible se llena en minutos.
 */
const BATCH = 3;
const GAP_MS = 3_000;

type Db = SupabaseClient<Database>;

let running = false;
let lastError: string | null = null;

/**
 * Una vuelta: toma los chats pendientes y les busca la foto. `liveSock`
 * devuelve el socket solo si está conectado; se consulta antes de cada chat
 * porque la conexión se puede caer en el medio de la tanda.
 */
export async function syncCloudAvatars(
  supabase: Db,
  liveSock: () => WASocket | null,
): Promise<void> {
  if (running || !liveSock()) return;
  running = true;
  try {
    const since = new Date(Date.now() - RECHECK_MS).toISOString();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, external_id, wa_phone")
      .eq("channel", WA_CLOUD_CHANNEL)
      .not("last_inbound_at", "is", null)
      // Nunca revisado, o revisado hace más de una semana y con mensajes
      // nuevos desde entonces.
      .or(
        `avatar_checked_at.is.null,and(avatar_checked_at.lt.${since},last_inbound_at.gt.${since})`,
      )
      .order("last_inbound_at", { ascending: false })
      .limit(BATCH);

    if (error) {
      // Sin el SQL corrido la consulta falla en cada vuelta: avisar una vez.
      if (error.message !== lastError) {
        console.error("[fotos] select error:", error.message);
        lastError = error.message;
      }
      return;
    }
    lastError = null;

    for (const [i, conv] of (data ?? []).entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
      const sock = liveSock();
      if (!sock) return;

      let path: string | null = null;
      try {
        path = await fetchCloudAvatar(supabase, sock, conv);
      } catch (err) {
        // Con el socket vivo, un error de un número puntual se da por
        // revisado: si no, ese chat encabezaría la cola en cada vuelta y
        // trabaría a todos los de atrás.
        console.warn(
          "[fotos] error con",
          conv.external_id,
          err instanceof Error ? err.message : err,
        );
      }
      // Se cayó la conexión a mitad de camino: el "no se ve" no es de fiar,
      // así que el chat queda pendiente para cuando vuelva.
      if (!liveSock()) return;

      const { error: updateError } = await supabase
        .from("conversations")
        .update({
          avatar_checked_at: new Date().toISOString(),
          // Sin foto visible no se borra la que ya hubiera: puede ser un
          // tropiezo de la red, y una foto vieja es mejor que las iniciales.
          ...(path ? { avatar_path: path } : {}),
        })
        .eq("id", conv.id);
      if (updateError) {
        console.error("[fotos] update error:", updateError.message);
        return;
      }
    }
  } finally {
    running = false;
  }
}

/**
 * La foto de un chat de la Cloud API, o null si no se ve.
 *
 * El `wa_id` de Meta no sirve tal cual como JID: los celulares argentinos
 * vienen sin el 9 ("543511234567") y en WhatsApp el usuario es
 * "5493511234567@s.whatsapp.net". `onWhatsApp` hace la misma búsqueda que la
 * agenda del teléfono y devuelve el JID verdadero.
 */
async function fetchCloudAvatar(
  supabase: Db,
  sock: WASocket,
  conv: { external_id: string; wa_phone: string | null },
): Promise<string | null> {
  const candidates = [
    ...new Set(
      [phoneDigits(conv.external_id), phoneDigits(conv.wa_phone)].filter(
        (d): d is string => d !== null,
      ),
    ),
  ];
  if (candidates.length === 0) return null;

  const [hit] = (await sock.onWhatsApp(...candidates)) ?? [];
  if (!hit?.exists) {
    console.log("🖼  sin WhatsApp:", candidates[0]);
    return null;
  }

  const digits = hit.jid.split("@")[0]?.replace(/\D/g, "") || candidates[0];
  // Mismo nombre de archivo que usa el chat del número viejo para la misma
  // persona: si escribió a los dos, comparten la foto.
  const path = await storeProfilePicture(supabase, sock, [hit.jid], digits);
  console.log(`🖼  foto ${path ? "✓" : "no visible"}:`, digits);
  return path;
}
