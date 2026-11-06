import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFlowMessage } from "@/lib/automations/message";
import { isWithinSendWindow } from "@/lib/automations/quiet-hours";
import { lacksCountryCode, resolveAudience } from "@/lib/broadcasts/audience";
import { parseBroadcastFiltersStrict } from "@/lib/broadcasts/filters";
import { WA_CLOUD_CHANNEL } from "@/lib/channels";
import { isSendable, loadAccount } from "@/lib/whatsapp-cloud/config";
import { resolveCloudConversation } from "@/lib/whatsapp-cloud/conversations";
import { CLOUD_WINDOW_MS } from "@/lib/whatsapp-cloud/window";
import type { Database } from "@/types/database.types";

/**
 * El envío de las difusiones (CRM → Configuración → Difusiones).
 *
 * Corre en el worker de la Cloud API porque es por donde sale todo lo que el
 * CRM manda sin que nadie escriba primero. No habla con Meta: encola en
 * `messages`, igual que las automatizaciones, y el poller de siempre lo manda.
 * Eso le da gratis los reintentos, los acuses, la burbuja en el chat y el
 * motivo en rojo cuando Meta rechaza.
 *
 * Cada vuelta hace dos cosas:
 *
 *   1. **Arrancar** lo programado que ya venció: reclama la difusión, saca la
 *      foto del segmento y la escribe en `broadcast_recipients`.
 *   2. **Vaciar** de a poco la cola de las que están saliendo.
 *
 * "De a poco" es la decisión importante. Encolar 800 mensajes de una dejaría
 * la cola de salida tapada: el poller manda por orden de llegada, y la
 * respuesta que la recepcionista escribe en un chat esperaría detrás de toda
 * la promo. Por eso la difusión solo agrega mensajes mientras la cola tenga
 * menos de `MAX_IN_FLIGHT` esperando, y la bandeja nunca espera más que eso.
 */

type Db = SupabaseClient<Database>;
type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];
type RecipientRow = Database["public"]["Tables"]["broadcast_recipients"]["Row"];

/**
 * Cuántos mensajes de la Cloud API puede haber esperando en la cola antes de
 * que la difusión deje de agregar. Con el poller mandando ~5 por segundo, es
 * una espera máxima de unos segundos para un mensaje escrito a mano.
 */
const MAX_IN_FLIGHT = 20;

/** Filas por insert al escribir la foto del segmento. */
const INSERT_CHUNK = 500;

/**
 * Una destinataria que quedó en 'processing' más que esto es un envío a
 * medias (el worker se reinició en el medio). No se reintenta sola: si el
 * mensaje llegó a encolarse, reintentar lo duplicaría.
 */
const STUCK_PROCESSING_MS = 10 * 60 * 1000;

/**
 * Margen contra el cierre de la ventana de 24 h en modo texto, igual que el de
 * los seguimientos: lo que sale clavado sobre el límite puede rebotar.
 */
const WINDOW_SAFETY_MS = 15 * 60 * 1000;

let running = false;

/**
 * Una vuelta del reloj de difusiones. Se protege contra solaparse consigo
 * misma: sacar la foto de un segmento grande puede tardar más que el
 * intervalo, y dos vueltas a la vez reclamarían las mismas destinatarias.
 */
export async function processBroadcasts(supabase: Db): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await startDueBroadcasts(supabase, now);
    await drainBroadcasts(supabase, now);
  } catch (err) {
    console.error(
      "[broadcasts] vuelta fallida:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    running = false;
  }
}

// ───────────────────────────── 1. Arrancar

async function startDueBroadcasts(supabase: Db, now: Date) {
  const { data: due, error } = await supabase
    .from("broadcasts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for")
    .limit(5);
  if (error) {
    console.error("[broadcasts] select scheduled error:", error.message);
    return;
  }

  for (const { id } of due ?? []) {
    // Claim optimista: solo una vuelta (o un proceso) se queda con ella, y
    // una cancelación que llegue antes gana.
    const { data: claimed } = await supabase
      .from("broadcasts")
      .update({ status: "sending", started_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();
    if (claimed) await materialize(supabase, claimed, now);
  }

  // Las que quedaron reclamadas sin foto: el worker murió entre el claim y el
  // insert. `audience_size` null es la marca. El único de la tabla hace que
  // recalcular no duplique a las que sí llegaron a escribirse.
  const { data: orphans } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("status", "sending")
    .is("audience_size", null)
    .limit(5);
  for (const b of orphans ?? []) await materialize(supabase, b, now);
}

/** Vuelve la difusión a borrador con el motivo a la vista en la tarjeta. */
async function backToDraft(supabase: Db, id: string, reason: string) {
  await supabase
    .from("broadcasts")
    .update({
      status: "draft",
      scheduled_for: null,
      started_at: null,
      last_error: reason.slice(0, 500),
    })
    .eq("id", id)
    .eq("status", "sending");
  console.warn(`[broadcasts] ${id} volvió a borrador: ${reason}`);
}

async function materialize(supabase: Db, b: BroadcastRow, now: Date) {
  const filters = parseBroadcastFiltersStrict(b.filters);
  if (!filters.ok) {
    await backToDraft(supabase, b.id, filters.error);
    return;
  }

  // La plantilla se valida una vez antes de escribir la cola: si Meta la
  // despublicó, fallarían todas las destinatarias por el mismo motivo. Mejor
  // frenar acá y decirlo una vez.
  const probe = await buildFlowMessage(supabase, b, { nombre: "Clienta" });
  if (!probe.ok) {
    await backToDraft(supabase, b.id, probe.error);
    return;
  }

  let audience;
  try {
    audience = await resolveAudience(supabase, filters.filters, {
      now,
      excludeBroadcastId: b.id,
    });
  } catch (err) {
    // Una consulta caída es transitoria: la difusión queda 'sending' sin
    // foto y la vuelta siguiente la reintenta como huérfana.
    console.error(
      `[broadcasts] no pudimos calcular el segmento de ${b.name}:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const rows = audience.members.map((m) => ({
    broadcast_id: b.id,
    client_id: m.clientId,
    full_name: m.fullName,
    phone: m.phone,
    status: "pending",
  }));

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await supabase
      .from("broadcast_recipients")
      .upsert(rows.slice(i, i + INSERT_CHUNK), {
        onConflict: "broadcast_id,client_id",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error(
        `[broadcasts] no pudimos escribir la cola de ${b.name}:`,
        error.message,
      );
      return; // sin audience_size: se reintenta como huérfana.
    }
  }

  const empty = rows.length === 0;
  await supabase
    .from("broadcasts")
    .update({
      audience_size: rows.length,
      ...(empty
        ? {
            status: "completed",
            completed_at: new Date().toISOString(),
            last_error:
              "Ninguna clienta cumplía los filtros al momento de enviar.",
          }
        : {}),
    })
    .eq("id", b.id);

  console.log(
    `📣 difusión "${b.name}" → ${rows.length} destinataria${rows.length === 1 ? "" : "s"} en cola`,
  );
}

// ───────────────────────────── 2. Vaciar

/** Mensajes de la Cloud API esperando en la cola de salida. */
async function cloudBacklog(supabase: Db): Promise<number | null> {
  const { count, error } = await supabase
    .from("messages")
    .select("id, conversations!inner(channel)", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("direction", "outbound")
    .is("revoked_at", null)
    .eq("conversations.channel", WA_CLOUD_CHANNEL);
  if (error) {
    console.error("[broadcasts] backlog count error:", error.message);
    return null;
  }
  return count ?? 0;
}

async function rescueStuckRecipients(supabase: Db, now: Date) {
  const cutoff = new Date(now.getTime() - STUCK_PROCESSING_MS).toISOString();
  await supabase
    .from("broadcast_recipients")
    .update({
      status: "failed",
      error:
        "El envío quedó a medias (se reinició el worker en el medio). Revisá el chat: si no le llegó, mandáselo a mano.",
    })
    .eq("status", "processing")
    .lt("processed_at", cutoff);
}

async function drainBroadcasts(supabase: Db, now: Date) {
  const { data: sending } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("status", "sending")
    .not("audience_size", "is", null)
    .order("started_at");
  if (!sending || sending.length === 0) return;

  await rescueStuckRecipients(supabase, now);

  // El cierre va antes que el horario y la cuenta: una difusión que terminó a
  // las 20:59 no tiene por qué figurar "Enviando" hasta las 9.
  const open: BroadcastRow[] = [];
  for (const b of sending) {
    if (!(await maybeComplete(supabase, b))) open.push(b);
  }
  if (open.length === 0) return;

  // Sin cuenta conectada no sale nada: la difusión espera en 'sending' en vez
  // de quemar a todas las destinatarias con el mismo error.
  const account = await loadAccount(supabase);
  if (!isSendable(account)) return;

  // Mismo horario que los seguimientos automáticos: lo que queda pendiente a
  // las 21 sigue a las 9 de la mañana siguiente.
  if (!isWithinSendWindow(now)) return;

  const backlog = await cloudBacklog(supabase);
  if (backlog === null) return;
  let budget = MAX_IN_FLIGHT - backlog;

  for (const b of open) {
    if (budget <= 0) return;

    const { data: pending } = await supabase
      .from("broadcast_recipients")
      .select("*")
      .eq("broadcast_id", b.id)
      .eq("status", "pending")
      .order("created_at")
      .order("id")
      .limit(budget);

    // Solo quedan a medias ('processing'): las cierra el rescate.
    if (!pending || pending.length === 0) continue;

    for (const r of pending) {
      if (budget <= 0) return;
      const handled = await sendToRecipient(supabase, b, r);
      if (handled) budget--;
    }
  }
}

/** Sin pendientes ni a medias: terminó. Devuelve si quedó cerrada. */
async function maybeComplete(supabase: Db, b: BroadcastRow): Promise<boolean> {
  const { count, error } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", b.id)
    .in("status", ["pending", "processing"]);
  if (error || (count ?? 0) > 0) return false;

  const { data } = await supabase
    .from("broadcasts")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "sending")
    .select("id")
    .maybeSingle();
  if (data) console.log(`📣 difusión "${b.name}" → terminada`);
  return true;
}

async function closeRecipient(
  supabase: Db,
  id: string,
  status: "skipped" | "failed",
  reason: string,
) {
  await supabase
    .from("broadcast_recipients")
    .update({
      status,
      error: reason.slice(0, 500),
      processed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Encola el mensaje de una destinataria. Devuelve `true` si la reclamó (y por
 * lo tanto gastó un lugar del presupuesto de la vuelta).
 */
async function sendToRecipient(
  supabase: Db,
  b: BroadcastRow,
  r: RecipientRow,
): Promise<boolean> {
  const { data: claim } = await supabase
    .from("broadcast_recipients")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .eq("id", r.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  // Ya la tomó otra vuelta, o la difusión se canceló en el medio.
  if (!claim) return false;

  try {
    const wantsTemplate = b.send_mode === "template";

    // Mismo criterio que las automatizaciones: con plantilla se le puede
    // escribir a quien nunca habló con el número nuevo, así que se abre el
    // chat; en modo texto Meta lo rebotaría, y abrir un chat vacío solo
    // ensuciaría la bandeja.
    let resolved = await resolveCloudConversation(supabase, {
      clientId: r.client_id,
      phone: r.phone,
      displayName: r.full_name,
      createIfMissing: false,
    });

    if (!resolved.conversationId && wantsTemplate) {
      // Escribirle por primera vez a un número sin código de país abriría un
      // chat vacío con un mensaje que Meta va a rebotar. Se saltea con el
      // motivo, que es lo accionable: corregir la ficha.
      if (lacksCountryCode(r.phone)) {
        await closeRecipient(
          supabase,
          r.id,
          "skipped",
          "El teléfono de la ficha no tiene código de país (por ejemplo 54 9 para un celular de Argentina) y todavía no tiene chat en el WhatsApp nuevo. Corregilo en la ficha de la clienta.",
        );
        return true;
      }
      resolved = await resolveCloudConversation(supabase, {
        clientId: r.client_id,
        phone: r.phone,
        displayName: r.full_name,
        createIfMissing: true,
      });
    }

    if (!resolved.conversationId) {
      await closeRecipient(
        supabase,
        r.id,
        wantsTemplate ? "failed" : "skipped",
        wantsTemplate
          ? (resolved.error ?? "No pudimos abrir el chat de WhatsApp de la clienta.")
          : "No tiene chat en el WhatsApp nuevo: un mensaje libre solo le llega a quien escribió en las últimas 24 h.",
      );
      return true;
    }
    const conversationId = resolved.conversationId;

    if (!wantsTemplate) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("last_inbound_at")
        .eq("id", conversationId)
        .maybeSingle();
      const lastInbound = conv?.last_inbound_at
        ? new Date(conv.last_inbound_at).getTime()
        : null;
      const open =
        lastInbound !== null &&
        Date.now() - lastInbound < CLOUD_WINDOW_MS - WINDOW_SAFETY_MS;
      if (!open) {
        await closeRecipient(
          supabase,
          r.id,
          "skipped",
          "No escribió en las últimas 24 h: un mensaje libre no le llega. Para alcanzarla hace falta una plantilla aprobada.",
        );
        return true;
      }
    }

    const built = await buildFlowMessage(supabase, b, {
      nombre: r.full_name.trim().split(/\s+/)[0] ?? "",
    });
    if (!built.ok) {
      await closeRecipient(supabase, r.id, "failed", built.error);
      return true;
    }

    // `sent_by` queda en null a propósito, como todo lo que encola el worker:
    // así el flujo "la clienta no contestó" no persigue a nadie por no
    // responder una promo.
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
      await closeRecipient(
        supabase,
        r.id,
        "failed",
        msgErr?.message ?? "No pudimos encolar el mensaje.",
      );
      return true;
    }

    await supabase
      .from("broadcast_recipients")
      .update({
        status: "queued",
        conversation_id: conversationId,
        message_id: msg.id,
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", r.id);

    return true;
  } catch (err) {
    await closeRecipient(
      supabase,
      r.id,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    return true;
  }
}
