import { z } from "zod";

/**
 * Los filtros de una difusión: qué clientas forman el segmento.
 *
 * Módulo puro a propósito: lo importan el editor del panel (browser), las
 * server actions que calculan la vista previa y el worker que arma la cola.
 * Los tres tienen que leer exactamente la misma forma, así que la forma vive
 * acá y en ningún otro lado. La base guarda el JSON tal cual
 * (`broadcasts.filters`) sin mirarlo.
 *
 * El modelo tiene dos partes que se combinan distinto, y la separación es a
 * propósito:
 *
 *   · `conditions` — QUIÉNES entran. Se combinan con `match`: todas a la vez
 *     o alguna. Sin condiciones entran todas las clientas.
 *   · `excludeTags` / `excludeRecentDays` — quiénes NO, pase lo que pase. Van
 *     aparte porque una exclusión metida entre condiciones con "alguna" deja
 *     de excluir: "es VIP o no tiene la etiqueta No molestar" incluye a casi
 *     todas, que es justo lo contrario de lo que se quería.
 */

export const MAX_FILTER_DAYS = 3650;

const days = z
  .number({ error: "Poné una cantidad de días." })
  .int("Tiene que ser un número entero.")
  .min(1, "Tiene que ser al menos 1 día.")
  .max(MAX_FILTER_DAYS, "Es demasiado tiempo.");

const optionalDays = days.nullable();

const amount = z
  .number()
  .min(0, "No puede ser negativo.")
  .nullable();

const uuidList = z.array(z.string().uuid());

export const broadcastConditionSchema = z.discriminatedUnion("type", [
  // Tiene alguna / todas estas etiquetas.
  z.object({
    type: z.literal("tags"),
    mode: z.enum(["any", "all"]),
    tags: z.array(z.string().min(1)).min(1, "Elegí al menos una etiqueta."),
  }),
  // Última visita: dentro de los últimos N días, hace más de N días, o nunca.
  z.object({
    type: z.literal("last_visit"),
    mode: z.enum(["within", "over", "never"]),
    days,
  }),
  // Cantidad de visitas entre min y max (cualquiera de los dos puede faltar).
  z.object({
    type: z.literal("visits"),
    min: amount,
    max: amount,
  }),
  // Gasto acumulado entre min y max.
  z.object({
    type: z.literal("spent"),
    min: amount,
    max: amount,
  }),
  // Se hizo alguno de estos servicios (opcionalmente, en los últimos N días).
  z.object({
    type: z.literal("services"),
    serviceIds: uuidList.min(1, "Elegí al menos un servicio."),
    withinDays: optionalDays,
  }),
  // La atendió alguna de estas profesionales.
  z.object({
    type: z.literal("professionals"),
    professionalIds: uuidList.min(1, "Elegí al menos una profesional."),
    withinDays: optionalDays,
  }),
  // Cumple años en alguno de estos meses (1-12).
  z.object({
    type: z.literal("birthday"),
    months: z
      .array(z.number().int().min(1).max(12))
      .min(1, "Elegí al menos un mes."),
  }),
  // Se cargó como clienta en los últimos N días.
  z.object({
    type: z.literal("new_clients"),
    days,
  }),
  // Tiene (o no) un turno agendado de hoy en adelante.
  z.object({
    type: z.literal("upcoming"),
    has: z.boolean(),
  }),
  // Escribió al WhatsApp nuevo en las últimas 24 h (o no).
  z.object({
    type: z.literal("chat_window"),
    open: z.boolean(),
  }),
]);

export type BroadcastCondition = z.infer<typeof broadcastConditionSchema>;
export type BroadcastConditionType = BroadcastCondition["type"];

export const broadcastFiltersSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(broadcastConditionSchema).max(20),
  excludeTags: z.array(z.string().min(1)),
  excludeRecentDays: optionalDays,
});

export type BroadcastFilters = z.infer<typeof broadcastFiltersSchema>;

export const EMPTY_BROADCAST_FILTERS: BroadcastFilters = {
  match: "all",
  conditions: [],
  excludeTags: [],
  excludeRecentDays: null,
};

/**
 * Lee `broadcasts.filters` para mostrarlo o editarlo, pieza por pieza.
 *
 * Lo que NO hace es caer en "sin filtros" ante un JSON que no entiende (una
 * fila tocada a mano, una versión vieja del formulario): en el editor eso
 * convertiría en silencio un segmento de 40 clientas en "todas", y bastaría
 * con tocar Guardar para mandarle la promo a toda la base. En cambio conserva
 * cada condición que sí se lee y cuenta las que tuvo que descartar, para que
 * el editor lo diga en voz alta.
 *
 * El worker no usa esto: ver `parseBroadcastFiltersStrict`.
 */
export function readBroadcastFilters(raw: unknown): {
  filters: BroadcastFilters;
  /** Condiciones o exclusiones guardadas que no se pudieron leer. */
  dropped: number;
} {
  const whole = broadcastFiltersSchema.safeParse(raw);
  if (whole.success) return { filters: whole.data, dropped: 0 };

  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  let dropped = 0;

  const rawConditions = Array.isArray(r.conditions) ? r.conditions : [];
  const conditions: BroadcastCondition[] = [];
  for (const c of rawConditions) {
    const parsed = broadcastConditionSchema.safeParse(c);
    if (parsed.success) conditions.push(parsed.data);
    else dropped++;
  }

  const rawExclude = Array.isArray(r.excludeTags) ? r.excludeTags : [];
  const excludeTags = rawExclude.filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  dropped += rawExclude.length - excludeTags.length;

  const recent = optionalDays.safeParse(r.excludeRecentDays ?? null);
  if (!recent.success) dropped++;

  // El esquema entero no pasó pero ninguna pieza puntual falló (falta `match`,
  // o directamente no es un objeto): algo se perdió igual, y "sin filtros" es
  // justamente lo único que no hay que suponer.
  if (dropped === 0) dropped = 1;

  return {
    filters: {
      match: r.match === "any" ? "any" : "all",
      conditions: conditions.slice(0, 20),
      excludeTags,
      excludeRecentDays: recent.success ? recent.data : null,
    },
    dropped,
  };
}

/** Solo el segmento legible, para mostrarlo en la tarjeta. */
export function broadcastFiltersOf(raw: unknown): BroadcastFilters {
  return readBroadcastFilters(raw).filters;
}

/**
 * Para el worker: un segmento que no se entiende NO puede convertirse en
 * "todas las clientas". Mandarle una promo a toda la base por un JSON mal
 * guardado es el peor error que puede tener esta función.
 */
export function parseBroadcastFiltersStrict(
  raw: unknown,
): { ok: true; filters: BroadcastFilters } | { ok: false; error: string } {
  const parsed = broadcastFiltersSchema.safeParse(raw);
  if (parsed.success) return { ok: true, filters: parsed.data };
  return {
    ok: false,
    error:
      "Los filtros guardados de la difusión no se pudieron leer. Abrila, revisá el segmento y volvé a programarla.",
  };
}

/** Lo que muestra el menú "Agregar filtro", en este orden. */
export const CONDITION_TYPES: {
  type: BroadcastConditionType;
  label: string;
  hint: string;
}[] = [
  { type: "tags", label: "Etiquetas", hint: "Tiene ciertas etiquetas" },
  { type: "last_visit", label: "Última visita", hint: "Vino hace poco, hace mucho o nunca" },
  { type: "services", label: "Servicios", hint: "Se hizo ciertos servicios" },
  { type: "professionals", label: "Profesional", hint: "La atendió cierta profesional" },
  { type: "visits", label: "Cantidad de visitas", hint: "Entre un mínimo y un máximo" },
  { type: "spent", label: "Gasto total", hint: "Lo que gastó en el salón" },
  { type: "birthday", label: "Cumpleaños", hint: "Cumple en ciertos meses" },
  { type: "new_clients", label: "Clientas nuevas", hint: "Se cargaron hace poco" },
  { type: "upcoming", label: "Turno agendado", hint: "Tiene o no tiene turno próximo" },
  { type: "chat_window", label: "Chat reciente", hint: "Escribió en las últimas 24 h" },
];

export const CONDITION_LABEL: Record<BroadcastConditionType, string> =
  Object.fromEntries(CONDITION_TYPES.map((c) => [c.type, c.label])) as Record<
    BroadcastConditionType,
    string
  >;

/** La condición recién agregada, con valores que ya tienen sentido. */
export function defaultCondition(
  type: BroadcastConditionType,
  now: Date = new Date(),
): BroadcastCondition {
  switch (type) {
    case "tags":
      return { type, mode: "any", tags: [] };
    case "last_visit":
      return { type, mode: "over", days: 60 };
    case "visits":
      return { type, min: 2, max: null };
    case "spent":
      return { type, min: null, max: null };
    case "services":
      return { type, serviceIds: [], withinDays: null };
    case "professionals":
      return { type, professionalIds: [], withinDays: null };
    case "birthday":
      return { type, months: [now.getMonth() + 1] };
    case "new_clients":
      return { type, days: 30 };
    case "upcoming":
      return { type, has: false };
    case "chat_window":
      return { type, open: true };
  }
}

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * Una línea en castellano por condición, para la tarjeta de la difusión y
 * para el resumen del editor. Los nombres de servicios y profesionales vienen
 * de afuera porque el filtro guarda ids.
 */
export function describeCondition(
  c: BroadcastCondition,
  lookups: {
    serviceName: (id: string) => string | undefined;
    professionalName: (id: string) => string | undefined;
  },
): string {
  switch (c.type) {
    case "tags":
      return c.tags.length === 1
        ? `Con la etiqueta ${c.tags[0]}`
        : `Con ${c.mode === "all" ? "todas las" : "alguna de las"} etiquetas ${listNames(c.tags)}`;
    case "last_visit":
      if (c.mode === "never") return "Nunca vinieron";
      return c.mode === "within"
        ? `Vinieron en los últimos ${plural(c.days, "día", "días")}`
        : `No vienen hace más de ${plural(c.days, "día", "días")}`;
    case "visits":
      return rangeText("visitas", c.min, c.max, (n) => String(n));
    case "spent":
      return rangeText("gasto", c.min, c.max, (n) => ARS.format(n));
    case "services": {
      const names = c.serviceIds.map((id) => lookups.serviceName(id) ?? "?");
      return `Se hicieron ${listNames(names)}${c.withinDays ? ` en los últimos ${plural(c.withinDays, "día", "días")}` : ""}`;
    }
    case "professionals": {
      const names = c.professionalIds.map(
        (id) => lookups.professionalName(id) ?? "?",
      );
      return `Las atendió ${listNames(names)}${c.withinDays ? ` en los últimos ${plural(c.withinDays, "día", "días")}` : ""}`;
    }
    case "birthday":
      return `Cumplen en ${listNames(
        [...c.months].sort((a, b) => a - b).map((m) => MONTHS[m - 1]),
        4,
      )}`;
    case "new_clients":
      return `Clientas nuevas de los últimos ${plural(c.days, "día", "días")}`;
    case "upcoming":
      return c.has ? "Tienen turno agendado" : "Sin turno agendado";
    case "chat_window":
      return c.open
        ? "Escribieron en las últimas 24 h"
        : "No escribieron en las últimas 24 h";
  }
}

function rangeText(
  what: string,
  min: number | null,
  max: number | null,
  fmt: (n: number) => string,
): string {
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  if (min !== null && max !== null) return `${label} entre ${fmt(min)} y ${fmt(max)}`;
  if (min !== null) return `${label}: ${fmt(min)} o más`;
  if (max !== null) return `${label}: hasta ${fmt(max)}`;
  return `${label}: cualquiera`;
}

/** Las exclusiones, en castellano. Vacío si no hay ninguna. */
export function describeExclusions(f: BroadcastFilters): string[] {
  const out: string[] = [];
  if (f.excludeTags.length > 0) {
    out.push(
      `Sin ${f.excludeTags.length === 1 ? "la etiqueta" : "las etiquetas"} ${listNames(f.excludeTags)}`,
    );
  }
  if (f.excludeRecentDays) {
    out.push(
      `Sin difusiones en los últimos ${plural(f.excludeRecentDays, "día", "días")}`,
    );
  }
  return out;
}
