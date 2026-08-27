import type { Database } from "@/types/database.types";

/**
 * Parseo y armado de plantillas de la Cloud API.
 *
 * Este módulo es puro a propósito: lo importan el selector de plantillas del
 * chat (browser), la server action que encola el envío y el worker que lo
 * manda. Nada de Supabase, ni de Next, ni de `process.env`.
 */

export type WhatsappTemplateRow =
  Database["public"]["Tables"]["whatsapp_templates"]["Row"];

/** Un componente del array `components` tal cual lo devuelve Meta. */
export type TemplateComponent = {
  type?: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // en HEADER: TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string;
  buttons?: Array<{
    type?: string;
    text?: string;
    url?: string;
    phone_number?: string;
  }>;
};

/**
 * Payload que se guarda en `messages.wa_template` y que el worker manda tal
 * cual dentro de `{ type: "template", template: ... }`.
 */
export type TemplateSendPayload = {
  name: string;
  language: { code: string };
  components?: Array<{
    type: "header" | "body";
    parameters: Array<{
      type: "text";
      text: string;
      parameter_name?: string;
    }>;
  }>;
};

/**
 * Los placeholders de una plantilla: `{{1}}`, `{{2}}`… (posicionales) o
 * `{{nombre}}` (con nombre). Meta no mezcla los dos estilos en una plantilla.
 */
const PLACEHOLDER_RE = /\{\{\s*([0-9]+|[a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractPlaceholders(text: string | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const token = match[1];
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  // Los posicionales se piden en orden numérico, no en orden de aparición.
  if (out.every((t) => /^\d+$/.test(t))) {
    out.sort((a, b) => Number(a) - Number(b));
  }
  return out;
}

export function componentsOf(row: WhatsappTemplateRow): TemplateComponent[] {
  return Array.isArray(row.components)
    ? (row.components as TemplateComponent[])
    : [];
}

export function bodyComponent(
  components: TemplateComponent[],
): TemplateComponent | null {
  return components.find((c) => c.type?.toUpperCase() === "BODY") ?? null;
}

export function headerComponent(
  components: TemplateComponent[],
): TemplateComponent | null {
  return components.find((c) => c.type?.toUpperCase() === "HEADER") ?? null;
}

export function footerComponent(
  components: TemplateComponent[],
): TemplateComponent | null {
  return components.find((c) => c.type?.toUpperCase() === "FOOTER") ?? null;
}

/** Variables que el usuario tiene que completar antes de enviar. */
export type TemplateVariables = {
  header: string[];
  body: string[];
};

export function templateVariables(
  components: TemplateComponent[],
): TemplateVariables {
  const header = headerComponent(components);
  const headerVars =
    header?.format?.toUpperCase() === "TEXT"
      ? extractPlaceholders(header.text)
      : [];
  return {
    header: headerVars,
    body: extractPlaceholders(bodyComponent(components)?.text),
  };
}

/**
 * Los botones de respuesta rápida de la plantilla, en orden.
 *
 * Son los únicos que vuelven al CRM cuando la clienta los toca: los de URL
 * abren el navegador y los de teléfono llaman, sin avisarle a Meta. Por eso
 * son también los únicos a los que un flujo puede tenerle una respuesta
 * preparada.
 */
export function quickReplyButtons(components: TemplateComponent[]): string[] {
  const buttons =
    components.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  return buttons
    .filter((b) => b.type?.toUpperCase() === "QUICK_REPLY")
    .map((b) => b.text?.trim() ?? "")
    .filter((text) => text.length > 0);
}

/**
 * Botones que no piden parámetros al enviar. Todo lo demás (OTP de las
 * plantillas de autenticación, COPY_CODE de cupones, FLOW, catálogo…)
 * requiere un componente `buttons` en el payload que todavía no armamos:
 * ofrecer esas plantillas terminaría en un rechazo 132000 de Meta.
 */
const STATIC_BUTTON_TYPES = new Set(["QUICK_REPLY", "PHONE_NUMBER", "URL"]);

/**
 * ¿Podemos enviar esta plantilla desde el CRM?
 *
 * Por ahora cubrimos plantillas de texto: header de texto (con o sin
 * variable), body y footer, más botones estáticos (quick reply / teléfono /
 * URL fija), que no requieren parámetros al enviar. Cabeceras multimedia,
 * botones dinámicos y las plantillas de autenticación necesitan parámetros
 * extra que el selector todavía no pide.
 */
export function templateSendability(
  components: TemplateComponent[],
  category?: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (category?.toUpperCase() === "AUTHENTICATION") {
    return {
      ok: false,
      reason: "Las plantillas de autenticación (códigos OTP) no se mandan desde el CRM.",
    };
  }

  const header = headerComponent(components);
  if (header && header.format && header.format.toUpperCase() !== "TEXT") {
    return {
      ok: false,
      reason: `Cabecera ${header.format.toLowerCase()} todavía no soportada desde el CRM.`,
    };
  }

  const buttons =
    components.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  for (const button of buttons) {
    const type = button.type?.toUpperCase() ?? "";
    if (!STATIC_BUTTON_TYPES.has(type)) {
      return {
        ok: false,
        reason: `Tiene un botón ${type.toLowerCase() || "desconocido"} que requiere parámetros todavía no soportados desde el CRM.`,
      };
    }
    if (type === "URL" && extractPlaceholders(button.url).length > 0) {
      return {
        ok: false,
        reason: "Tiene un botón con URL variable, todavía no soportado desde el CRM.",
      };
    }
  }

  if (!bodyComponent(components)?.text) {
    return { ok: false, reason: "La plantilla no tiene cuerpo de texto." };
  }

  return { ok: true };
}

function substitute(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (raw, token: string) => {
    const value = values[token];
    return value !== undefined && value !== "" ? value : raw;
  });
}

/**
 * Texto plano de la plantilla con las variables puestas. Es lo que se guarda
 * en `messages.body` para que la burbuja del chat muestre lo que se mandó.
 */
export function renderTemplatePreview(
  components: TemplateComponent[],
  values: TemplateVariableValues,
): string {
  const parts: string[] = [];

  const header = headerComponent(components);
  if (header?.format?.toUpperCase() === "TEXT" && header.text) {
    parts.push(substitute(header.text, values.header));
  }

  const body = bodyComponent(components);
  if (body?.text) parts.push(substitute(body.text, values.body));

  const footer = footerComponent(components);
  if (footer?.text) parts.push(footer.text);

  return parts.join("\n\n");
}

export type TemplateVariableValues = {
  header: Record<string, string>;
  body: Record<string, string>;
};

function toParameters(
  tokens: string[],
  values: Record<string, string>,
): Array<{ type: "text"; text: string; parameter_name?: string }> {
  const positional = tokens.every((t) => /^\d+$/.test(t));
  return tokens.map((token) => ({
    type: "text" as const,
    text: values[token] ?? "",
    // Las plantillas con parámetros nombrados requieren `parameter_name`;
    // las posicionales se mandan en orden y sin nombre.
    ...(positional ? {} : { parameter_name: token }),
  }));
}

/**
 * Arma el payload de envío. Tira si falta completar alguna variable: mandar
 * un parámetro vacío es un rechazo seguro de Meta (error 132000/132012),
 * mejor cortarlo antes de encolar.
 */
export function buildTemplatePayload(args: {
  name: string;
  language: string;
  components: TemplateComponent[];
  values: TemplateVariableValues;
}): TemplateSendPayload {
  const vars = templateVariables(args.components);

  for (const token of vars.header) {
    if (!args.values.header[token]?.trim()) {
      throw new Error(`Falta completar la variable {{${token}}} de la cabecera.`);
    }
  }
  for (const token of vars.body) {
    if (!args.values.body[token]?.trim()) {
      throw new Error(`Falta completar la variable {{${token}}}.`);
    }
  }

  const components: TemplateSendPayload["components"] = [];
  if (vars.header.length > 0) {
    components.push({
      type: "header",
      parameters: toParameters(vars.header, args.values.header),
    });
  }
  if (vars.body.length > 0) {
    components.push({
      type: "body",
      parameters: toParameters(vars.body, args.values.body),
    });
  }

  return {
    name: args.name,
    language: { code: args.language },
    ...(components.length > 0 ? { components } : {}),
  };
}

/**
 * Valida que un `messages.wa_template` leído de la base tenga la forma
 * mínima para mandarse. El worker lo usa antes de llamar a Meta: un payload
 * roto (por un insert a mano, por ejemplo) falla acá con un error claro.
 */
export function parseStoredTemplatePayload(
  raw: unknown,
): TemplateSendPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const language = p.language as Record<string, unknown> | undefined;
  if (typeof p.name !== "string" || typeof language?.code !== "string") {
    return null;
  }
  return raw as TemplateSendPayload;
}
