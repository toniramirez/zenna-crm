import {
  bodyComponent,
  extractPlaceholders,
  footerComponent,
  headerComponent,
  type TemplateComponent,
} from "./templates";

/**
 * Armado de plantillas nuevas para el WhatsApp Manager, desde el CRM.
 *
 * Contraparte de `templates.ts`: aquel parsea lo que Meta ya aprobó y arma el
 * payload de **envío**; este arma el payload de **creación** y valida el
 * borrador antes de gastarle un viaje a Meta (una plantilla rechazada por un
 * error de forma tarda lo mismo en volver que una legítima, y el WABA tiene
 * cupo de plantillas por mes).
 *
 * Puro a propósito, igual que `templates.ts`: lo importan el editor del panel
 * (browser) y la server action que llama a la Graph API.
 */

export const TEMPLATE_LANGUAGES = [
  { code: "es_AR", label: "Español (Argentina)" },
  { code: "es", label: "Español" },
  { code: "es_ES", label: "Español (España)" },
  { code: "es_MX", label: "Español (México)" },
  { code: "en_US", label: "Inglés (EE. UU.)" },
  { code: "pt_BR", label: "Portugués (Brasil)" },
] as const;

/**
 * `AUTHENTICATION` queda afuera a propósito: son las plantillas de códigos
 * OTP, que se mandan con un componente `buttons` que el CRM no arma (ver
 * `templateSendability`). Crear una desde acá sería crear algo que después no
 * se puede enviar.
 */
export const TEMPLATE_CATEGORIES = [
  {
    value: "UTILITY",
    label: "Utilidad",
    hint: "Sobre un turno ya existente: recordatorios, confirmaciones, avisos. Es la que corresponde a casi todo lo del CRM.",
  },
  {
    value: "MARKETING",
    label: "Marketing",
    hint: "Promos, novedades, invitaciones a volver. Más cara y la clienta la puede silenciar.",
  },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["value"];

export type TemplateButtonDraft =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type TemplateDraft = {
  name: string;
  language: string;
  category: TemplateCategory;
  /** Cabecera de texto. Vacía = plantilla sin cabecera. */
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButtonDraft[];
  /** Valor de ejemplo por variable — Meta los exige para poder revisarla. */
  examples: Record<string, string>;
};

export function emptyTemplateDraft(): TemplateDraft {
  return {
    name: "",
    language: "es_AR",
    category: "UTILITY",
    header: "",
    body: "",
    footer: "",
    buttons: [],
    examples: {},
  };
}

// ─────────────────────────────────────────── Límites de Meta

export const TEMPLATE_LIMITS = {
  name: 512,
  header: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  url: 2000,
  /** Meta acepta hasta 10 botones, con tope por tipo. */
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
} as const;

const NAME_RE = /^[a-z0-9_]+$/;
const NAMED_PARAM_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Meta solo acepta nombres en minúscula, números y guiones bajos. En vez de
 * rechazar "Recordatorio de turno" lo normalizamos mientras se escribe: es lo
 * que hace el propio WhatsApp Manager.
 */
export function normalizeTemplateName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // acentos
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, TEMPLATE_LIMITS.name);
}

// ─────────────────────────────────────────── Variables del borrador

export type DraftPlaceholders = {
  header: string[];
  body: string[];
  /** Header + body sin repetidos, en el orden en que hay que pedir ejemplos. */
  all: string[];
  /** `{{1}}`, `{{2}}`… en vez de `{{nombre}}`. */
  positional: boolean;
};

export function draftPlaceholders(draft: TemplateDraft): DraftPlaceholders {
  const header = extractPlaceholders(draft.header);
  const body = extractPlaceholders(draft.body);
  const all = [...header, ...body.filter((t) => !header.includes(t))];
  return {
    header,
    body,
    all,
    // Sin variables da igual: `parameter_format` no viaja en ese caso.
    positional: all.length > 0 && all.every((t) => /^\d+$/.test(t)),
  };
}

/** Un valor de ejemplo razonable para las variables que ya conoce el CRM. */
const SAMPLE_VALUES: Record<string, string> = {
  nombre: "María",
  servicio: "Corte y color",
  fecha: "10 may",
  hora: "14:30",
  profesional: "Sofía",
  salon: "Zenna",
  link: "https://g.page/r/zenna/review",
};

export function suggestedExample(token: string): string {
  return SAMPLE_VALUES[token] ?? "ejemplo";
}

// ─────────────────────────────────────────── Validación

export type DraftValidation = {
  /** Impiden mandar el borrador a Meta. */
  errors: string[];
  /** Motivos frecuentes de rechazo, pero no seguros: solo se avisan. */
  warnings: string[];
};

export function validateTemplateDraft(draft: TemplateDraft): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = draft.name.trim();
  if (!name) errors.push("Poné un nombre para la plantilla.");
  else if (!NAME_RE.test(name)) {
    errors.push("El nombre solo puede tener minúsculas, números y guiones bajos.");
  } else if (name.length > TEMPLATE_LIMITS.name) {
    errors.push(`El nombre no puede pasar de ${TEMPLATE_LIMITS.name} caracteres.`);
  }

  if (!draft.language.trim()) errors.push("Elegí el idioma.");

  const body = draft.body.trim();
  if (!body) errors.push("El cuerpo del mensaje no puede quedar vacío.");
  if (draft.body.length > TEMPLATE_LIMITS.body) {
    errors.push(`El cuerpo no puede pasar de ${TEMPLATE_LIMITS.body} caracteres.`);
  }
  if (draft.header.length > TEMPLATE_LIMITS.header) {
    errors.push(`La cabecera no puede pasar de ${TEMPLATE_LIMITS.header} caracteres.`);
  }
  if (draft.footer.length > TEMPLATE_LIMITS.footer) {
    errors.push(`El pie no puede pasar de ${TEMPLATE_LIMITS.footer} caracteres.`);
  }
  if (extractPlaceholders(draft.footer).length > 0) {
    errors.push("El pie no admite variables.");
  }

  const vars = draftPlaceholders(draft);

  if (vars.header.length > 1) {
    errors.push("La cabecera admite una sola variable.");
  }

  // Meta no mezcla los dos estilos en una misma plantilla.
  const named = vars.all.filter((t) => !/^\d+$/.test(t));
  if (named.length > 0 && named.length !== vars.all.length) {
    errors.push(
      "No mezcles variables con nombre ({{nombre}}) y numeradas ({{1}}): elegí un estilo.",
    );
  }
  for (const token of named) {
    if (!NAMED_PARAM_RE.test(token)) {
      errors.push(
        `La variable {{${token}}} no sirve: solo minúsculas, números y guiones bajos, empezando por letra.`,
      );
    }
  }
  if (vars.positional) {
    // Posicionales: tienen que ser 1..n sin saltos, o Meta rechaza.
    const numbers = vars.all.map(Number).sort((a, b) => a - b);
    const expected = numbers.map((_, i) => i + 1);
    if (numbers.join(",") !== expected.join(",")) {
      errors.push(
        `Las variables numeradas tienen que ir de {{1}} a {{${numbers.length}}} sin saltearse ninguna.`,
      );
    }
  }

  for (const token of vars.all) {
    if (!draft.examples[token]?.trim()) {
      errors.push(`Falta el ejemplo de {{${token}}}.`);
    }
  }

  // Reglas de estilo que Meta aplica con criterio propio: avisar, no frenar.
  if (body && /^\s*\{\{/.test(draft.body)) {
    warnings.push("El cuerpo empieza con una variable — Meta suele rechazar eso.");
  }
  if (body && /\}\}\s*$/.test(draft.body)) {
    warnings.push("El cuerpo termina con una variable — Meta suele rechazar eso.");
  }
  if (/\}\}\s*\{\{/.test(draft.body)) {
    warnings.push("Hay dos variables pegadas; poné texto entre las dos.");
  }

  const buttons = draft.buttons;
  if (buttons.length > TEMPLATE_LIMITS.buttons) {
    errors.push(`Como máximo ${TEMPLATE_LIMITS.buttons} botones.`);
  }
  if (buttons.filter((b) => b.type === "URL").length > TEMPLATE_LIMITS.urlButtons) {
    errors.push(`Como máximo ${TEMPLATE_LIMITS.urlButtons} botones de link.`);
  }
  if (
    buttons.filter((b) => b.type === "PHONE_NUMBER").length >
    TEMPLATE_LIMITS.phoneButtons
  ) {
    errors.push("Como máximo un botón de llamada.");
  }
  buttons.forEach((button, i) => {
    const label = `Botón ${i + 1}`;
    if (!button.text.trim()) errors.push(`${label}: falta el texto.`);
    else if (button.text.length > TEMPLATE_LIMITS.buttonText) {
      errors.push(
        `${label}: el texto no puede pasar de ${TEMPLATE_LIMITS.buttonText} caracteres.`,
      );
    }
    if (button.type === "URL") {
      const url = button.url.trim();
      if (!url) errors.push(`${label}: falta el link.`);
      else if (!/^https?:\/\/\S+$/i.test(url)) {
        errors.push(`${label}: el link tiene que empezar con https://`);
      } else if (url.length > TEMPLATE_LIMITS.url) {
        errors.push(`${label}: el link es demasiado largo.`);
      }
      // Un botón con URL variable pide un parámetro que el CRM todavía no
      // manda al enviar: la plantilla quedaría aprobada pero inservible.
      if (extractPlaceholders(url).length > 0) {
        errors.push(`${label}: el link no puede tener variables.`);
      }
    }
    if (button.type === "PHONE_NUMBER" && !button.phone_number.trim()) {
      errors.push(`${label}: falta el número de teléfono.`);
    }
  });

  return { errors, warnings };
}

// ─────────────────────────────────────────── Payloads

/**
 * Los `components` tal como los espera `POST /<WABA_ID>/message_templates`.
 * Con `example` adentro: sin ejemplos Meta rechaza la plantilla sin revisarla.
 */
type CreateComponent = Record<string, unknown>;

function namedExamples(
  tokens: string[],
  examples: Record<string, string>,
): Array<{ param_name: string; example: string }> {
  return tokens.map((token) => ({
    param_name: token,
    example: examples[token]?.trim() ?? "",
  }));
}

export type TemplateCreatePayload = {
  name: string;
  language: string;
  category: TemplateCategory;
  parameter_format?: "NAMED" | "POSITIONAL";
  components: CreateComponent[];
};

export function buildTemplateCreatePayload(
  draft: TemplateDraft,
): TemplateCreatePayload {
  const vars = draftPlaceholders(draft);
  const components: CreateComponent[] = [];

  const header = draft.header.trim();
  if (header) {
    const component: CreateComponent = { type: "HEADER", format: "TEXT", text: header };
    if (vars.header.length > 0) {
      component.example = vars.positional
        ? { header_text: vars.header.map((t) => draft.examples[t]?.trim() ?? "") }
        : { header_text_named_params: namedExamples(vars.header, draft.examples) };
    }
    components.push(component);
  }

  const body: CreateComponent = { type: "BODY", text: draft.body.trim() };
  if (vars.body.length > 0) {
    body.example = vars.positional
      ? // El body espera una matriz: una fila de valores por ejemplo, y con
        // una sola fila alcanza.
        { body_text: [vars.body.map((t) => draft.examples[t]?.trim() ?? "")] }
      : { body_text_named_params: namedExamples(vars.body, draft.examples) };
  }
  components.push(body);

  const footer = draft.footer.trim();
  if (footer) components.push({ type: "FOOTER", text: footer });

  if (draft.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: draft.buttons.map((button) => {
        switch (button.type) {
          case "QUICK_REPLY":
            return { type: "QUICK_REPLY", text: button.text.trim() };
          case "URL":
            return { type: "URL", text: button.text.trim(), url: button.url.trim() };
          case "PHONE_NUMBER":
            return {
              type: "PHONE_NUMBER",
              text: button.text.trim(),
              phone_number: button.phone_number.trim(),
            };
        }
      }),
    });
  }

  return {
    name: draft.name.trim(),
    language: draft.language,
    category: draft.category,
    // Solo se declara cuando hay variables con nombre; el default de Meta es
    // posicional y mandarlo de más en una plantilla sin variables es ruido.
    ...(vars.all.length > 0 && !vars.positional
      ? { parameter_format: "NAMED" as const }
      : {}),
    components,
  };
}

/**
 * El camino inverso: una plantilla cacheada → borrador editable.
 *
 * Los ejemplos vienen dentro de los propios componentes cuando la plantilla la
 * creamos nosotros o Meta los devolvió al sincronizar; los que falten se
 * completan con un valor sugerido, porque el editor no puede guardar sin
 * ellos.
 */
export function componentsToDraft(row: {
  name: string;
  language: string;
  category: string | null;
  components: TemplateComponent[];
}): TemplateDraft {
  const header = headerComponent(row.components);
  const footer = footerComponent(row.components);
  const buttons =
    row.components.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];

  const draft: TemplateDraft = {
    name: row.name,
    language: row.language,
    category:
      row.category?.toUpperCase() === "MARKETING" ? "MARKETING" : "UTILITY",
    header: header?.format?.toUpperCase() === "TEXT" ? (header.text ?? "") : "",
    body: bodyComponent(row.components)?.text ?? "",
    footer: footer?.text ?? "",
    buttons: buttons.flatMap((button): TemplateButtonDraft[] => {
      const text = button.text ?? "";
      switch (button.type?.toUpperCase()) {
        case "QUICK_REPLY":
          return [{ type: "QUICK_REPLY", text }];
        case "URL":
          return [{ type: "URL", text, url: button.url ?? "" }];
        case "PHONE_NUMBER":
          return [
            { type: "PHONE_NUMBER", text, phone_number: button.phone_number ?? "" },
          ];
        default:
          // Un botón que el CRM no sabe editar (OTP, flow, copy code): se
          // descarta del borrador y el editor avisa que no se puede editar.
          return [];
      }
    }),
    examples: {},
  };

  const fromMeta = exampleValues(row.components);
  for (const token of draftPlaceholders(draft).all) {
    draft.examples[token] = fromMeta[token] ?? suggestedExample(token);
  }
  return draft;
}

/** Los `example` que Meta guarda dentro de cada componente, por token. */
function exampleValues(
  components: TemplateComponent[],
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const component of components) {
    const type = component.type?.toUpperCase();
    if (type !== "HEADER" && type !== "BODY") continue;
    const tokens = extractPlaceholders(component.text);
    if (tokens.length === 0) continue;

    const example = (component as { example?: Record<string, unknown> }).example;
    if (!example) continue;

    const named =
      example[type === "HEADER" ? "header_text_named_params" : "body_text_named_params"];
    if (Array.isArray(named)) {
      for (const entry of named as Array<Record<string, unknown>>) {
        const key = entry?.param_name;
        if (typeof key === "string" && typeof entry.example === "string") {
          out[key] = entry.example;
        }
      }
      continue;
    }

    // Posicionales: el header trae un array plano y el body una matriz.
    const raw = example[type === "HEADER" ? "header_text" : "body_text"];
    const values = (
      type === "HEADER" ? raw : Array.isArray(raw) ? raw[0] : undefined
    ) as unknown;
    if (Array.isArray(values)) {
      tokens.forEach((token, i) => {
        const value = values[i];
        if (typeof value === "string") out[token] = value;
      });
    }
  }

  return out;
}

/**
 * ¿Podemos editar esta plantilla desde el CRM? Las que tienen cabecera
 * multimedia o botones que no sabemos armar se abrirían mutiladas: mejor
 * mandar al WhatsApp Manager que hacerle perder el trabajo a alguien.
 */
export function templateEditability(
  components: TemplateComponent[],
  category?: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (category?.toUpperCase() === "AUTHENTICATION") {
    return {
      ok: false,
      reason: "Las plantillas de autenticación se editan desde el WhatsApp Manager.",
    };
  }
  const header = headerComponent(components);
  if (header && header.format && header.format.toUpperCase() !== "TEXT") {
    return {
      ok: false,
      reason: `Tiene una cabecera ${header.format.toLowerCase()}: se edita desde el WhatsApp Manager.`,
    };
  }
  const buttons =
    components.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  const editable = new Set(["QUICK_REPLY", "URL", "PHONE_NUMBER"]);
  if (buttons.some((b) => !editable.has(b.type?.toUpperCase() ?? ""))) {
    return {
      ok: false,
      reason: "Tiene botones que el CRM no sabe editar. Usá el WhatsApp Manager.",
    };
  }
  return { ok: true };
}
