import { graphUrl, type WhatsappCloudAccount } from "./config";
import type { TemplateCreatePayload } from "./template-draft";
import type { TemplateSendPayload } from "./templates";

/**
 * Cliente de la WhatsApp Cloud API (Graph API oficial de Meta).
 *
 * Todo el tráfico saliente hacia Meta pasa por acá: el worker (envíos), las
 * server actions de Configuración (validar conexión, sincronizar plantillas)
 * y la ingesta del webhook (bajar media). Solo servidor: nunca importar desde
 * un componente "use client" — maneja el token.
 */

export type GraphError = {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { details?: string };
  /*
   * El motivo en castellano de andar por casa. Meta manda medio rechazo en
   * `message` —casi siempre el genérico "Invalid parameter"— y el motivo de
   * verdad en estos dos, que es lo único que le sirve a quien está mirando la
   * pantalla. Pasa sobre todo en el endpoint de plantillas.
   */
  error_user_title?: string;
  error_user_msg?: string;
};

/**
 * Códigos que sí conviene reintentar: límites de velocidad y errores
 * internos de Meta. El resto de los 4xx no mejora reintentando.
 */
const TRANSIENT_CODES = new Set([
  1, // API unknown — suele ser un hipo de Meta
  2, // API service — caída temporal
  4, // API too many calls
  80007, // rate limit del WABA
  130429, // rate limit hit
  131000, // something went wrong (genérico de WhatsApp)
  131016, // service overloaded
  131048, // spam rate limit — parar y reintentar más tarde
  131056, // demasiados mensajes al mismo destinatario en poco tiempo
]);

export class WhatsappApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly details?: string;
  /** `error_user_title` / `error_user_msg`: el motivo listo para mostrar. */
  readonly userTitle?: string;
  readonly userMessage?: string;

  constructor(message: string, status: number, graph?: GraphError) {
    super(message);
    this.name = "WhatsappApiError";
    this.status = status;
    this.code = graph?.code;
    this.subcode = graph?.error_subcode;
    this.details = graph?.error_data?.details;
    this.userTitle = graph?.error_user_title;
    this.userMessage = graph?.error_user_msg;
  }

  /** Todo lo que Meta dijo, sin repetir, para logs y mensajes de último recurso. */
  get fullMessage(): string {
    const parts = [this.message];
    const human = [this.userTitle, this.userMessage].filter(Boolean).join(": ");
    if (human && !this.message.includes(human)) parts.push(human);
    if (this.details && !this.message.includes(this.details)) {
      parts.push(this.details);
    }
    return parts.join(" — ");
  }

  /**
   * Errores que no mejoran reintentando: token vencido, plantilla mal armada,
   * fuera de la ventana de 24 h, número inexistente… El worker los marca
   * `failed` directo. Red caída y rate limits vuelven a la cola.
   */
  get isPermanent(): boolean {
    if (this.status === 0 || this.status >= 500) return false;
    if (this.code !== undefined && TRANSIENT_CODES.has(this.code)) return false;
    return true;
  }

  /** ¿Meta rechazó por estar fuera de la ventana de 24 h? */
  get isOutsideWindow(): boolean {
    return this.code === 131047;
  }

  /** ¿El token no sirve más? */
  get isAuthError(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

async function graphFetch<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Un timeout/corte de red sí conviene reintentarlo → status 0 (no permanente).
    throw new WhatsappApiError(`Fallo de red hacia Meta: ${msg}`, 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Meta devolvió algo que no es JSON (típico en un 502 de su edge).
  }

  if (!res.ok) {
    const graph = (json as { error?: GraphError } | null)?.error;
    const details = graph?.error_data?.details;
    const error = new WhatsappApiError(
      (graph?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`) +
        (details ? ` — ${details}` : ""),
      res.status,
      graph,
    );
    // El error entero al log del servidor: es lo único que queda cuando el
    // mensaje que ve el usuario resulta ser un "Invalid parameter" pelado.
    console.error(
      `[wa-cloud] ${res.status} ${new URL(url).pathname}:`,
      JSON.stringify({
        code: graph?.code,
        subcode: graph?.error_subcode,
        message: error.fullMessage,
      }),
    );
    throw error;
  }

  return json as T;
}

type SendableAccount = WhatsappCloudAccount & {
  access_token: string;
  phone_number_id: string;
};

// ─────────────────────────────────────────── Envío de mensajes

/**
 * El cuerpo de POST /<PHONE_NUMBER_ID>/messages sin el sobre común
 * (`messaging_product`, `to`), que pone `sendCloudMessage`.
 */
export type CloudMessagePayload =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "template"; template: TemplateSendPayload }
  | { type: "image"; image: { link: string; caption?: string } }
  | { type: "video"; video: { link: string; caption?: string } }
  | { type: "audio"; audio: { link: string } }
  | { type: "sticker"; sticker: { link: string } }
  | {
      type: "document";
      document: { link: string; caption?: string; filename?: string };
    }
  | { type: "reaction"; reaction: { message_id: string; emoji: string } };

type SendResponse = {
  messages?: Array<{ id?: string }>;
};

/**
 * POST /<PHONE_NUMBER_ID>/messages — el único endpoint de envío.
 * `to` son los dígitos del número en formato internacional, sin `+`.
 * Devuelve el `wamid`, que es el `external_id` con el que después llegan los
 * acuses (sent/delivered/read) por el webhook.
 */
export async function sendCloudMessage(args: {
  account: SendableAccount;
  to: string;
  payload: CloudMessagePayload;
}): Promise<string | null> {
  const result = await graphFetch<SendResponse>(
    graphUrl(`${args.account.phone_number_id}/messages`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.account.access_token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to,
        ...args.payload,
      }),
    },
  );

  return result.messages?.[0]?.id ?? null;
}

export function textPayload(body: string): CloudMessagePayload {
  // Sin preview: un link en un recordatorio de turno no necesita tarjeta.
  return { type: "text", text: { body, preview_url: false } };
}

export function templatePayload(
  template: TemplateSendPayload,
): CloudMessagePayload {
  return { type: "template", template };
}

export function reactionPayload(
  targetWamid: string,
  emoji: string,
): CloudMessagePayload {
  // Emoji vacío = sacar la reacción, misma convención que el resto del CRM.
  return { type: "reaction", reaction: { message_id: targetWamid, emoji } };
}

export function mediaPayload(args: {
  type: "image" | "video" | "audio" | "document" | "sticker";
  link: string;
  caption?: string | null;
  filename?: string | null;
}): CloudMessagePayload {
  const caption = args.caption?.trim() || undefined;
  switch (args.type) {
    case "image":
      return { type: "image", image: { link: args.link, caption } };
    case "video":
      return { type: "video", video: { link: args.link, caption } };
    case "audio":
      // La Cloud API no acepta caption en audio.
      return { type: "audio", audio: { link: args.link } };
    case "sticker":
      return { type: "sticker", sticker: { link: args.link } };
    case "document":
      return {
        type: "document",
        document: {
          link: args.link,
          caption,
          filename: args.filename ?? undefined,
        },
      };
  }
}

// ─────────────────────────────────────────── Cuenta

export type PhoneNumberInfo = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

/**
 * Valida un token + phone_number_id y devuelve los datos del número. Es lo
 * que corre el panel de configuración al conectar: si esto responde, la
 * dupla sirve para enviar.
 */
export async function fetchPhoneNumberInfo(args: {
  accessToken: string;
  phoneNumberId: string;
}): Promise<PhoneNumberInfo> {
  return graphFetch<PhoneNumberInfo>(
    graphUrl(
      `${args.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    ),
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
}

// ─────────────────────────────────────────── Plantillas

export type RemoteTemplate = {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: unknown[];
};

type TemplatesPage = {
  data?: RemoteTemplate[];
  paging?: { next?: string };
};

/**
 * Lista todas las plantillas del WABA, siguiendo la paginación. El tope de
 * páginas es una red de seguridad, no un límite real: un salón tiene decenas
 * de plantillas, no miles.
 */
export async function fetchTemplates(args: {
  accessToken: string;
  wabaId: string;
}): Promise<RemoteTemplate[]> {
  const all: RemoteTemplate[] = [];
  let url: string | undefined = graphUrl(
    `${args.wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100`,
  );

  for (let page = 0; url && page < 10; page++) {
    const result: TemplatesPage = await graphFetch<TemplatesPage>(url, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });
    all.push(...(result.data ?? []));
    url = result.paging?.next;
  }

  return all;
}

/**
 * `POST /<WABA_ID>/message_templates` — crea una plantilla en el WABA.
 *
 * Meta la devuelve en estado `PENDING` y la revisa aparte (minutos, a veces
 * horas); el resultado llega solo por el webhook
 * `message_template_status_update`. Los errores de forma, en cambio, vuelven
 * acá mismo: nombre repetido, ejemplo faltante, botón mal armado.
 */
export async function createTemplate(args: {
  accessToken: string;
  wabaId: string;
  template: TemplateCreatePayload;
}): Promise<{ id?: string; status?: string; category?: string }> {
  return graphFetch(graphUrl(`${args.wabaId}/message_templates`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify(args.template),
  });
}

/**
 * `POST /<TEMPLATE_ID>` — reedita una plantilla ya creada. Meta no deja
 * cambiarle el nombre ni el idioma (son su identidad), así que solo viajan
 * los componentes y, si la plantilla está aprobada, la categoría.
 *
 * Vuelve a quedar en revisión. Una plantilla aprobada se puede editar unas
 * pocas veces por mes; una rechazada, siempre.
 */
export async function updateTemplate(args: {
  accessToken: string;
  metaId: string;
  template: TemplateCreatePayload;
}): Promise<{ success?: boolean }> {
  const { category, components, parameter_format } = args.template;
  const editable = {
    category,
    components,
    ...(parameter_format ? { parameter_format } : {}),
  };
  return graphFetch(graphUrl(args.metaId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify(editable),
  });
}

/**
 * `DELETE /<WABA_ID>/message_templates` — borra una plantilla.
 *
 * Con `hsm_id` borra solo ese idioma; sin él, Meta borra **todos** los idiomas
 * que compartan el nombre. Siempre mandamos el id cuando lo tenemos.
 *
 * Ojo: el nombre queda reservado 30 días y una plantilla borrada no se puede
 * usar más, ni siquiera en envíos ya encolados.
 */
export async function deleteTemplate(args: {
  accessToken: string;
  wabaId: string;
  name: string;
  metaId?: string | null;
}): Promise<{ success?: boolean }> {
  const params = new URLSearchParams({ name: args.name });
  if (args.metaId) params.set("hsm_id", args.metaId);
  return graphFetch(
    graphUrl(`${args.wabaId}/message_templates?${params.toString()}`),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.accessToken}` },
    },
  );
}

// ─────────────────────────────────────────── Media entrante

export type MediaInfo = {
  url?: string;
  mime_type?: string;
  file_size?: number;
};

/**
 * Los mensajes entrantes traen un `media_id`, no una URL. Primero se pide la
 * URL (firmada, vence a los 5 minutos) y después se descarga con el token.
 */
export async function fetchMediaInfo(args: {
  accessToken: string;
  mediaId: string;
}): Promise<MediaInfo> {
  return graphFetch<MediaInfo>(graphUrl(args.mediaId), {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
}

/** Descarga el binario de la CDN de Meta. La URL exige el mismo Bearer. */
export async function downloadMedia(args: {
  accessToken: string;
  url: string;
}): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(args.url, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[wa-cloud] media fetch HTTP ${res.status}`);
      return null;
    }
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    return { buffer: Buffer.from(await res.arrayBuffer()), mime };
  } catch (err) {
    console.error(
      "[wa-cloud] media download failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
