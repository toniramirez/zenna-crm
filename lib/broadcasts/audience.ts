import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneDigits, phoneKey, WA_CLOUD_CHANNEL } from "@/lib/channels";
import { CLOUD_WINDOW_MS } from "@/lib/whatsapp-cloud/window";
import type { Database } from "@/types/database.types";
import type { BroadcastCondition, BroadcastFilters } from "./filters";

type Db = SupabaseClient<Database>;

/**
 * El segmento de una difusión: qué clientas cumplen los filtros.
 *
 * Lo usan dos caminos que tienen que dar el mismo número: la vista previa del
 * editor ("143 clientas") y el worker cuando arranca el envío. Si dijeran
 * cosas distintas, la dueña aprobaría una difusión a 143 y saldría a 600.
 *
 * Se resuelve en TypeScript y no en una función de Postgres porque los
 * filtros ya viven acá (lib/broadcasts/filters.ts) y una segunda copia en SQL
 * se desincronizaría al primer filtro nuevo. El costo es traer la base de
 * clientas en páginas de 1000, que para un salón son unas pocas vueltas.
 */

const PAGE = 1000;
/** Red de seguridad, no un límite real: 50 páginas son 50 mil filas. */
const MAX_PAGES = 50;

/**
 * ¿El teléfono de la ficha está cargado sin código de país?
 *
 * "351 123-4567" (10 dígitos) o "0351 …" (con el 0 de larga distancia): Meta
 * lo leería como un número de otro país y rebotaría el envío. Con código de
 * país casi ningún número del mundo baja de 11 dígitos, y ningún código de
 * país empieza con 0.
 *
 * No hace falta que el número esté bien si la clienta ya tiene chat en el
 * WhatsApp nuevo: ahí se le escribe al `wa_id` que dio Meta, no a la ficha.
 * Por eso esto solo importa para las que habría que escribirles por primera
 * vez.
 */
export function lacksCountryCode(digits: string): boolean {
  return digits.length <= 10 || digits.startsWith("0");
}

export type AudienceMember = {
  clientId: string;
  fullName: string;
  /** Dígitos del teléfono, listos para la Cloud API. */
  phone: string;
};

export type AudienceResult = {
  members: AudienceMember[];
  /** Cumplen las condiciones (antes de exclusiones, teléfono y duplicados). */
  matched: number;
  /** Las sacó una exclusión (etiqueta o difusión reciente). */
  excluded: number;
  /** Sin teléfono válido en la ficha. */
  noPhone: number;
  /** Mismo número que otra clienta del segmento: les llega un solo mensaje. */
  duplicates: number;
  /**
   * Sin chat en el WhatsApp nuevo y con el teléfono sin código de país: el
   * worker las va a saltear. Solo se calcula con `checkReachability`.
   */
  shortPhones: number;
};

type ClientRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  | "id"
  | "full_name"
  | "phone"
  | "tags"
  | "last_visit_at"
  | "total_visits"
  | "total_spent"
  | "birthday"
  | "created_at"
>;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * Trae todas las filas de una consulta paginando con `range`. La consulta
 * tiene que venir con un `order` estable, o las páginas se pisan.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  // Mejor fallar que mandar a un segmento recortado sin avisar.
  throw new Error(
    `La consulta del segmento superó las ${PAGE * MAX_PAGES} filas.`,
  );
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

// ───────────────────────────── Conjuntos que salen de otras tablas

/**
 * Clientas que tuvieron un turno —ya pasado, no cancelado ni ausente— con
 * alguno de estos servicios o profesionales. Se mira `appointment_services`
 * y no `appointments.professional_id` porque un turno puede tener un
 * servicio con cada profesional, y "la atendió Caro" es por servicio.
 */
async function clientsWithPastServices(
  supabase: Db,
  column: "service_id" | "professional_id",
  ids: string[],
  withinDays: number | null,
  now: Date,
): Promise<Set<string>> {
  const rows = await fetchAll<{ appointments: { client_id: string } | null }>(
    (from, to) => {
      let q = supabase
        .from("appointment_services")
        .select("id, appointments!inner(client_id, starts_at, status)")
        .in(column, ids)
        .lte("appointments.starts_at", now.toISOString())
        .not("appointments.status", "in", '("cancelled","no_show")');
      if (withinDays) {
        q = q.gte("appointments.starts_at", daysAgo(now, withinDays));
      }
      return q.order("id").range(from, to) as unknown as PageResult<{
        appointments: { client_id: string } | null;
      }>;
    },
  );
  return new Set(
    rows.map((r) => r.appointments?.client_id).filter((id): id is string => !!id),
  );
}

/** Clientas con un turno de ahora en adelante que sigue en pie. */
async function clientsWithUpcoming(supabase: Db, now: Date): Promise<Set<string>> {
  const rows = await fetchAll<{ client_id: string }>((from, to) =>
    supabase
      .from("appointments")
      .select("client_id")
      .gte("starts_at", now.toISOString())
      .in("status", ["scheduled", "confirmed"])
      .order("id")
      .range(from, to),
  );
  return new Set(rows.map((r) => r.client_id));
}

/**
 * Clientas que escribieron al número nuevo en las últimas 24 h: las únicas a
 * las que un mensaje libre les llega. Solo cuenta el chat vinculado a la
 * ficha, que es como después el worker lo encuentra.
 */
async function clientsWithOpenWindow(supabase: Db, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - CLOUD_WINDOW_MS).toISOString();
  const rows = await fetchAll<{ client_id: string | null }>((from, to) =>
    supabase
      .from("conversations")
      .select("client_id")
      .eq("channel", WA_CLOUD_CHANNEL)
      .not("client_id", "is", null)
      .gte("last_inbound_at", since)
      .order("id")
      .range(from, to),
  );
  return new Set(rows.map((r) => r.client_id).filter((id): id is string => !!id));
}

/**
 * Quiénes ya tienen chat en el WhatsApp nuevo: por clienta vinculada y por
 * los últimos 8 dígitos del número, los mismos dos caminos con los que
 * `resolveCloudConversation` lo encuentra al mandar.
 */
async function cloudChats(
  supabase: Db,
): Promise<{ clientIds: Set<string>; phoneKeys: Set<string> }> {
  const rows = await fetchAll<{
    client_id: string | null;
    external_id: string;
    wa_phone: string | null;
  }>((from, to) =>
    supabase
      .from("conversations")
      .select("client_id, external_id, wa_phone")
      .eq("channel", WA_CLOUD_CHANNEL)
      .order("id")
      .range(from, to),
  );
  const clientIds = new Set<string>();
  const phoneKeys = new Set<string>();
  for (const r of rows) {
    if (r.client_id) clientIds.add(r.client_id);
    // Solo sirven los que tienen código de país: un chat abierto con el
    // número mal cargado no es uno al que Meta vaya a entregar.
    for (const raw of [r.external_id, r.wa_phone]) {
      const digits = phoneDigits(raw);
      const key = phoneKey(raw);
      if (digits && key && !lacksCountryCode(digits)) phoneKeys.add(key);
    }
  }
  return { clientIds, phoneKeys };
}

/** Clientas a las que ya les salió una difusión en los últimos N días. */
async function clientsWithRecentBroadcast(
  supabase: Db,
  days: number,
  now: Date,
  excludeBroadcastId: string | null,
): Promise<Set<string>> {
  const rows = await fetchAll<{ client_id: string | null }>((from, to) => {
    let q = supabase
      .from("broadcast_recipients")
      .select("client_id")
      .eq("status", "queued")
      .not("client_id", "is", null)
      .gte("processed_at", daysAgo(now, days));
    if (excludeBroadcastId) q = q.neq("broadcast_id", excludeBroadcastId);
    return q.order("id").range(from, to);
  });
  return new Set(rows.map((r) => r.client_id).filter((id): id is string => !!id));
}

// ───────────────────────────── Evaluación

type Lookups = {
  services: Map<number, Set<string>>;
  professionals: Map<number, Set<string>>;
  upcoming: Set<string> | null;
  openWindow: Set<string> | null;
};

function birthdayMonth(birthday: string | null): number | null {
  if (!birthday) return null;
  const month = Number(birthday.slice(5, 7));
  return month >= 1 && month <= 12 ? month : null;
}

function inRange(value: number, min: number | null, max: number | null): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function matchesCondition(
  client: ClientRow,
  c: BroadcastCondition,
  index: number,
  lookups: Lookups,
  now: Date,
): boolean {
  switch (c.type) {
    case "tags":
      return c.mode === "all"
        ? c.tags.every((t) => client.tags.includes(t))
        : c.tags.some((t) => client.tags.includes(t));
    case "last_visit": {
      if (c.mode === "never") return client.last_visit_at === null;
      if (!client.last_visit_at) return false;
      const threshold = now.getTime() - c.days * 86_400_000;
      const visited = new Date(client.last_visit_at).getTime();
      return c.mode === "within" ? visited >= threshold : visited < threshold;
    }
    case "visits":
      return inRange(client.total_visits, c.min, c.max);
    case "spent":
      return inRange(Number(client.total_spent), c.min, c.max);
    case "services":
      return lookups.services.get(index)?.has(client.id) ?? false;
    case "professionals":
      return lookups.professionals.get(index)?.has(client.id) ?? false;
    case "birthday": {
      const month = birthdayMonth(client.birthday);
      return month !== null && c.months.includes(month);
    }
    case "new_clients":
      return (
        new Date(client.created_at).getTime() >=
        now.getTime() - c.days * 86_400_000
      );
    case "upcoming":
      return (lookups.upcoming?.has(client.id) ?? false) === c.has;
    case "chat_window":
      return (lookups.openWindow?.has(client.id) ?? false) === c.open;
  }
}

/**
 * Calcula el segmento.
 *
 * `excludeBroadcastId` es la difusión que se está armando: al recalcular la
 * cola de una difusión ya empezada, sus propias destinatarias no cuentan como
 * "recibió una difusión reciente".
 */
export async function resolveAudience(
  supabase: Db,
  filters: BroadcastFilters,
  options: {
    now?: Date;
    excludeBroadcastId?: string | null;
    /**
     * Contar cuántas no van a poder recibirla por el teléfono (`shortPhones`).
     * Lo pide la vista previa; el worker no, porque lo decide destinataria
     * por destinataria al mandar.
     */
    checkReachability?: boolean;
  } = {},
): Promise<AudienceResult> {
  const now = options.now ?? new Date();
  const conditions = filters.conditions;

  // Las consultas a otras tablas van en paralelo y solo si algún filtro las
  // pide: la vista previa se recalcula mientras se edita.
  const lookups: Lookups = {
    services: new Map(),
    professionals: new Map(),
    upcoming: null,
    openWindow: null,
  };

  const pending: Promise<void>[] = [];
  conditions.forEach((c, index) => {
    if (c.type === "services") {
      pending.push(
        clientsWithPastServices(supabase, "service_id", c.serviceIds, c.withinDays, now).then(
          (set) => void lookups.services.set(index, set),
        ),
      );
    } else if (c.type === "professionals") {
      pending.push(
        clientsWithPastServices(
          supabase,
          "professional_id",
          c.professionalIds,
          c.withinDays,
          now,
        ).then((set) => void lookups.professionals.set(index, set)),
      );
    }
  });
  if (conditions.some((c) => c.type === "upcoming")) {
    pending.push(
      clientsWithUpcoming(supabase, now).then((set) => {
        lookups.upcoming = set;
      }),
    );
  }
  if (conditions.some((c) => c.type === "chat_window")) {
    pending.push(
      clientsWithOpenWindow(supabase, now).then((set) => {
        lookups.openWindow = set;
      }),
    );
  }

  let recent: Set<string> | null = null;
  if (filters.excludeRecentDays) {
    pending.push(
      clientsWithRecentBroadcast(
        supabase,
        filters.excludeRecentDays,
        now,
        options.excludeBroadcastId ?? null,
      ).then((set) => {
        recent = set;
      }),
    );
  }

  let chats: Awaited<ReturnType<typeof cloudChats>> | null = null;
  if (options.checkReachability) {
    pending.push(
      cloudChats(supabase).then((result) => {
        chats = result;
      }),
    );
  }

  const clientsPromise = fetchAll<ClientRow>((from, to) =>
    supabase
      .from("clients")
      .select(
        "id, full_name, phone, tags, last_visit_at, total_visits, total_spent, birthday, created_at",
      )
      // El orden es el de la cola: por nombre, que es como después se lee la
      // lista de destinatarias. El id desempata para que la paginación no se
      // pise con dos clientas del mismo nombre.
      .order("full_name")
      .order("id")
      .range(from, to),
  );

  const [clients] = await Promise.all([clientsPromise, ...pending]);

  const matchedClients = clients.filter((client) => {
    if (conditions.length === 0) return true;
    const test = (c: BroadcastCondition, i: number) =>
      matchesCondition(client, c, i, lookups, now);
    return filters.match === "all"
      ? conditions.every(test)
      : conditions.some(test);
  });

  const recentSet = recent as Set<string> | null;
  const excludeTags = filters.excludeTags;
  const kept = matchedClients.filter(
    (client) =>
      !excludeTags.some((t) => client.tags.includes(t)) &&
      !(recentSet?.has(client.id) ?? false),
  );

  const chatsFound = chats as Awaited<ReturnType<typeof cloudChats>> | null;
  const members: AudienceMember[] = [];
  const seenPhones = new Set<string>();
  let noPhone = 0;
  let duplicates = 0;
  let shortPhones = 0;

  for (const client of kept) {
    const digits = phoneDigits(client.phone);
    const key = phoneKey(client.phone);
    if (!digits || !key) {
      noPhone++;
      continue;
    }
    // Dos fichas con el mismo número (la clienta cargada dos veces, una mamá
    // y su hija con el celular de la mamá): un solo mensaje. Se compara por
    // los últimos 8 dígitos, igual que la búsqueda de chats.
    if (seenPhones.has(key)) {
      duplicates++;
      continue;
    }
    seenPhones.add(key);
    if (
      chatsFound &&
      lacksCountryCode(digits) &&
      !chatsFound.clientIds.has(client.id) &&
      !chatsFound.phoneKeys.has(key)
    ) {
      shortPhones++;
    }
    members.push({
      clientId: client.id,
      fullName: client.full_name,
      phone: digits,
    });
  }

  return {
    members,
    matched: matchedClients.length,
    excluded: matchedClients.length - kept.length,
    noPhone,
    duplicates,
    shortPhones,
  };
}
