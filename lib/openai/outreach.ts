/**
 * Outreach recommender: takes a pool of dormant clients + the active service
 * catalog and asks GPT to pick which clients to re-engage, with what service,
 * and how to phrase the message.
 *
 * The prompt explicitly demands variety in tone/length/opening across the
 * batch so the messages don't read as a template blast when the owner sends
 * them out one after another from WhatsApp Web.
 */

import { chatCompletion } from "./client";

export type OutreachCandidate = {
  clientId: string;
  fullName: string;
  /** First name only, used in the prompt to keep PII surface small. */
  firstName: string;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  totalVisits: number;
  hairNotes: string | null;
  /**
   * Recent service history (last ~6 months), ordered most recent first.
   * Each entry: service name + category + how many times she got it.
   */
  history: { serviceName: string; category: string; times: number }[];
};

export type ServiceOption = {
  id: string;
  name: string;
  category: string;
  price: number;
};

export type OutreachSuggestion = {
  clientId: string;
  serviceId: string | null;
  reason: string;
  messageBody: string;
};

const SYSTEM_PROMPT = `Sos asistente de marketing de un salón de belleza en Argentina. Recibís una lista de clientas dormidas (no vienen hace tiempo) con su historial de servicios, y un catálogo de servicios activos del salón.

Tu tarea: elegir hasta N clientas para contactar por WhatsApp y, para cada una, redactar un mensaje breve, cálido y personalizado ofreciendo un servicio compatible o complementario al historial.

REGLAS CRÍTICAS:
1. Español rioplatense informal (usá "vos", no "tú"). Tono natural, como si lo escribiera un humano que la conoce, no un bot.
2. VARIEDAD obligatoria entre mensajes del lote: distintos saludos, distintas longitudes (entre 1 y 4 oraciones), distinta estructura. Si dos mensajes empiezan igual, mal.
3. NO uses palabras tipo "promo", "oferta", "campaña", "descuento del X%" ni números explícitos de descuento. Frasealo como "te quería invitar", "te tengo guardado un mimo", "se me ocurrió que te puede venir bien", etc.
4. Mencioná el servicio sugerido de forma natural, sin sonar a folleto. Idealmente conectalo con algo de su historial ("ya que la última vez te encantó el X...").
5. Una sola clienta puede recibir UNA sugerencia. No dupliques.
6. Si una clienta no tiene historial suficiente o no encontrás un servicio compatible, NO la incluyas en la respuesta. Mejor menos sugerencias buenas que muchas genéricas.
7. NO inventes nombres de servicios — usá exactamente los que están en el catálogo. service_id debe ser uno del catálogo.
8. NO firmes el mensaje. NO uses emojis excesivos (máximo uno cada dos mensajes).
9. "reason" es una explicación corta interna (1 oración) que verá el dueño del salón para decidir si enviar — no es parte del mensaje.

FORMATO DE RESPUESTA: un único objeto JSON con la forma:
{
  "suggestions": [
    {
      "client_id": "<uuid de la clienta>",
      "service_id": "<uuid del servicio sugerido>",
      "reason": "<explicación breve interna>",
      "message_body": "<el mensaje listo para enviar por WhatsApp>"
    }
  ]
}`;

function buildUserPrompt(
  candidates: OutreachCandidate[],
  services: ServiceOption[],
  limit: number,
): string {
  const servicesList = services
    .map(
      (s) =>
        `- id=${s.id} | "${s.name}" | categoría=${s.category} | $${s.price}`,
    )
    .join("\n");

  const candidatesList = candidates
    .map((c) => {
      const history =
        c.history.length === 0
          ? "sin historial reciente"
          : c.history
              .slice(0, 6)
              .map(
                (h) =>
                  `${h.serviceName} (${h.category}, x${h.times})`,
              )
              .join(", ");
      const lastVisit =
        c.daysSinceLastVisit !== null
          ? `hace ${c.daysSinceLastVisit} días`
          : "sin registro";
      const notes = c.hairNotes ? ` | notas: ${c.hairNotes}` : "";
      return `- client_id=${c.clientId} | ${c.firstName} | última visita: ${lastVisit} | visitas totales: ${c.totalVisits} | historial: ${history}${notes}`;
    })
    .join("\n");

  return `CATÁLOGO DE SERVICIOS ACTIVOS:
${servicesList}

CLIENTAS CANDIDATAS (${candidates.length}):
${candidatesList}

Elegí hasta ${limit} clientas y redactá una sugerencia personalizada para cada una siguiendo las reglas. Devolvé el JSON con la propiedad "suggestions".`;
}

/**
 * Generate outreach suggestions via GPT. Returns the parsed suggestions and
 * the model name that produced them (for audit trail in generated_by).
 */
export async function generateOutreachSuggestions({
  candidates,
  services,
  limit,
  signal,
}: {
  candidates: OutreachCandidate[];
  services: ServiceOption[];
  limit: number;
  signal?: AbortSignal;
}): Promise<{ suggestions: OutreachSuggestion[]; model: string }> {
  if (candidates.length === 0 || services.length === 0) {
    return { suggestions: [], model: "" };
  }

  const { content, model } = await chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(candidates, services, limit) },
    ],
    temperature: 0.85,
    jsonMode: true,
    signal,
  });

  const parsed = parseSuggestions(content);
  const validIds = new Set(candidates.map((c) => c.clientId));
  const validServiceIds = new Set(services.map((s) => s.id));

  // Defensive: drop any suggestion that hallucinated an unknown id, and
  // de-dupe by client_id (rule 5 from the prompt — but trust nothing).
  const seen = new Set<string>();
  const clean: OutreachSuggestion[] = [];
  for (const s of parsed) {
    if (!validIds.has(s.clientId)) continue;
    if (seen.has(s.clientId)) continue;
    seen.add(s.clientId);
    clean.push({
      ...s,
      serviceId: s.serviceId && validServiceIds.has(s.serviceId) ? s.serviceId : null,
    });
    if (clean.length >= limit) break;
  }

  return { suggestions: clean, model };
}

function parseSuggestions(raw: string): OutreachSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(arr)) return [];

  const out: OutreachSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const clientId = typeof obj.client_id === "string" ? obj.client_id : null;
    const serviceId = typeof obj.service_id === "string" ? obj.service_id : null;
    const reason = typeof obj.reason === "string" ? obj.reason : "";
    const messageBody =
      typeof obj.message_body === "string" ? obj.message_body : "";
    if (!clientId || !messageBody.trim()) continue;
    out.push({
      clientId,
      serviceId,
      reason: reason.trim(),
      messageBody: messageBody.trim(),
    });
  }
  return out;
}
