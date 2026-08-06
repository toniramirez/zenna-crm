import { graphUrl, IG_API_VERSION, type InstagramAccount } from "./config";

export type GraphError = {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

export class InstagramApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;

  constructor(message: string, status: number, graph?: GraphError) {
    super(message);
    this.name = "InstagramApiError";
    this.status = status;
    this.code = graph?.code;
    this.subcode = graph?.error_subcode;
  }

  /**
   * Errores que no mejoran reintentando: token vencido/revocado, permisos,
   * o fuera de la ventana de 24 h. El worker los marca `failed` directo.
   */
  get isPermanent(): boolean {
    if (this.status === 400 || this.status === 403) return true;
    // 190 = token inválido, 10 = permiso faltante, 200 = permiso insuficiente.
    return this.code === 190 || this.code === 10 || this.code === 200;
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
    throw new InstagramApiError(`Fallo de red hacia Meta: ${msg}`, 0);
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
    throw new InstagramApiError(
      graph?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      graph,
    );
  }

  return json as T;
}

// ─────────────────────────────────────────── Envío de mensajes

type SendResponse = { recipient_id?: string; message_id?: string };

type MessagePayload =
  | { text: string }
  | {
      attachment: {
        type: "image" | "video" | "audio" | "file";
        payload: { url: string; is_reusable?: boolean };
      };
    };

/**
 * POST /<IG_ID>/messages — el único endpoint de envío de DMs.
 *
 * `tag: "HUMAN_AGENT"` extiende la ventana de respuesta de 24 h a 7 días y es
 * exactamente nuestro caso: responde una persona desde la recepción, no un bot.
 * Requiere el permiso `human_agent` aprobado en la app de Meta; si no está,
 * Meta rechaza el mensaje con un error permanente y el worker lo marca fallido.
 */
export async function sendMessage(args: {
  account: InstagramAccount & { access_token: string; ig_user_id: string };
  recipientId: string;
  message: MessagePayload;
  humanAgentTag?: boolean;
}): Promise<SendResponse> {
  const body: Record<string, unknown> = {
    recipient: { id: args.recipientId },
    message: args.message,
  };
  if (args.humanAgentTag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }

  return graphFetch<SendResponse>(
    graphUrl(args.account.login_type, `${args.account.ig_user_id}/messages`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.account.access_token}`,
      },
      body: JSON.stringify(body),
    },
  );
}

export function textMessage(text: string): MessagePayload {
  return { text };
}

export function attachmentMessage(
  type: "image" | "video" | "audio" | "file",
  url: string,
): MessagePayload {
  return { attachment: { type, payload: { url } } };
}

/**
 * Reacciones. Van por `sender_action`, no por `message`.
 *
 * Instagram solo deja *enviar* el corazón (`love`), aunque sí notifica todas
 * las que mandan del otro lado. El emoji que elija la recepcionista se ignora:
 * el que llega es ❤️.
 */
export async function sendReaction(args: {
  account: InstagramAccount & { access_token: string; ig_user_id: string };
  recipientId: string;
  targetMessageId: string;
  remove?: boolean;
}): Promise<SendResponse> {
  const body = {
    recipient: { id: args.recipientId },
    sender_action: args.remove ? "unreact" : "react",
    payload: {
      message_id: args.targetMessageId,
      ...(args.remove ? {} : { reaction: "love" }),
    },
  };

  return graphFetch<SendResponse>(
    graphUrl(args.account.login_type, `${args.account.ig_user_id}/messages`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.account.access_token}`,
      },
      body: JSON.stringify(body),
    },
  );
}

// ─────────────────────────────────────────── Cuenta y token

export type IgProfile = {
  user_id?: string;
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
};

/**
 * Valida un token y devuelve a quién pertenece. Es lo que corre el panel de
 * configuración al conectar: si esto responde, el token sirve.
 */
export async function fetchOwnProfile(args: {
  accessToken: string;
  loginType: string;
}): Promise<IgProfile> {
  const fields =
    args.loginType === "facebook"
      ? "id,username,name"
      : "user_id,username,name,profile_picture_url";

  return graphFetch<IgProfile>(
    `${graphUrl(args.loginType, "me")}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
}

/**
 * Perfil de quien nos escribe (nombre + foto) para mostrarlo en la bandeja.
 * Meta solo lo entrega si esa persona nos mandó un DM, que es justo el caso.
 */
export async function fetchContactProfile(args: {
  account: InstagramAccount & { access_token: string };
  igsid: string;
}): Promise<IgProfile | null> {
  try {
    return await graphFetch<IgProfile>(
      `${graphUrl(args.account.login_type, args.igsid)}?fields=name,username,profile_pic`,
      { headers: { Authorization: `Bearer ${args.account.access_token}` } },
    );
  } catch (err) {
    // El perfil es decorativo: si Meta lo niega, seguimos con el IGSID.
    console.warn(
      "[instagram] no pudimos leer el perfil del contacto:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

type RefreshResponse = { access_token: string; expires_in: number };

/**
 * Renueva un token de larga duración de Instagram Login. Meta los emite por
 * 60 días y solo permite refrescarlos si tienen más de 24 h de vida. Conviene
 * correrlo bastante antes del vencimiento: si el token muere, hay que
 * reconectar la cuenta a mano.
 *
 * Solo aplica a `login_type = 'instagram'`. Los tokens de Página (Facebook
 * Login) no se refrescan por esta vía.
 */
export async function refreshLongLivedToken(
  accessToken: string,
): Promise<RefreshResponse> {
  return graphFetch<RefreshResponse>(
    `https://graph.instagram.com/${IG_API_VERSION}/refresh_access_token` +
      `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`,
  );
}

/**
 * Cambia un token de corta duración (el que devuelve el login / el Graph API
 * Explorer) por uno de 60 días. Es el paso que hace el panel al conectar.
 */
export async function exchangeForLongLivedToken(args: {
  shortLivedToken: string;
  appSecret: string;
}): Promise<RefreshResponse> {
  return graphFetch<RefreshResponse>(
    `https://graph.instagram.com/access_token` +
      `?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(args.appSecret)}` +
      `&access_token=${encodeURIComponent(args.shortLivedToken)}`,
  );
}
