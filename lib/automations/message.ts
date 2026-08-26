import type { SupabaseClient } from "@supabase/supabase-js";
import { renderTemplate } from "@/lib/validations/crm-config";
import {
  buildTemplatePayload,
  componentsOf,
  renderTemplatePreview,
  templateSendability,
  templateVariables,
  type TemplateVariableValues,
} from "@/lib/whatsapp-cloud/templates";
import type { Database, Json } from "@/types/database.types";

type Db = SupabaseClient<Database>;

export type AutomationFlowRow =
  Database["public"]["Tables"]["automation_flows"]["Row"];

/** Las variables del CRM que se pueden meter en un mensaje automático. */
export type FlowContext = Record<string, string>;

/**
 * Con qué se rellena cada placeholder de la plantilla. Los valores son
 * mini-plantillas del CRM (`"{{nombre}}"`, `"Hola {{nombre}}"`, o texto fijo)
 * que se resuelven con el contexto del turno justo antes de encolar.
 */
export type FlowTemplateParams = {
  header: Record<string, string>;
  body: Record<string, string>;
};

export const EMPTY_TEMPLATE_PARAMS: FlowTemplateParams = {
  header: {},
  body: {},
};

/** Lee `automation_flows.template_params` sin confiar en su forma. */
export function templateParamsOf(raw: unknown): FlowTemplateParams {
  if (typeof raw !== "object" || raw === null) return EMPTY_TEMPLATE_PARAMS;
  const p = raw as Record<string, unknown>;
  const pick = (value: unknown): Record<string, string> => {
    if (typeof value !== "object" || value === null) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    );
  };
  return { header: pick(p.header), body: pick(p.body) };
}

/**
 * Los campos de `messages` que definen QUÉ se manda: el texto de la burbuja y,
 * si es una plantilla, el payload que el worker le pasa tal cual a Meta.
 */
export type FlowMessageContent = {
  body: string;
  wa_template: Json | null;
};

/**
 * `ok` es un discriminante explícito y no un `error?: string`: TypeScript no
 * estrecha uniones por la verdad de una propiedad opcional, y sin él cada
 * llamador tendría que volver a comprobar que `content` existe después de
 * haber comprobado que no hubo error.
 */
export type FlowMessageResult =
  | { ok: true; content: FlowMessageContent }
  | { ok: false; error: string };

/**
 * Meta rechaza (error 132000) los parámetros con saltos de línea, tabs o más
 * de cuatro espacios seguidos. Se normaliza acá y no en la UI porque el valor
 * final recién existe al renderizar el contexto del turno.
 */
function cleanParam(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Arma el mensaje de un flujo de automatización.
 *
 * En modo `text` es el `message_body` con las variables reemplazadas — el
 * comportamiento de siempre, que solo llega si la conversación está dentro de
 * la ventana de 24 h de la Cloud API.
 *
 * En modo `template` sale una plantilla aprobada del WABA, que es la única
 * forma de que un recordatorio de turno le llegue a alguien que no escribió
 * en las últimas 24 h (o sea: casi siempre). La plantilla se resuelve contra
 * la caché local; si no está aprobada o pide parámetros que todavía no
 * sabemos armar, se devuelve el motivo en vez de encolar algo que Meta va a
 * rebotar.
 */
export async function buildFlowMessage(
  supabase: Db,
  flow: Pick<
    AutomationFlowRow,
    "send_mode" | "message_body" | "template_name" | "template_language" | "template_params"
  >,
  ctx: FlowContext,
): Promise<FlowMessageResult> {
  if (flow.send_mode !== "template") {
    return {
      ok: true,
      content: {
        body: renderTemplate(flow.message_body, ctx),
        wa_template: null,
      },
    };
  }

  if (!flow.template_name || !flow.template_language) {
    return {
      ok: false,
      error: "El flujo está en modo plantilla pero no tiene una elegida.",
    };
  }

  const { data: template } = await supabase
    .from("whatsapp_templates")
    .select("*")
    .eq("name", flow.template_name)
    .eq("language", flow.template_language)
    .maybeSingle();

  if (!template) {
    return {
      ok: false,
      error: `La plantilla "${flow.template_name}" (${flow.template_language}) no está en el CRM. Sincronizá las plantillas desde Configuración.`,
    };
  }
  if (template.status.toUpperCase() !== "APPROVED") {
    return {
      ok: false,
      error: `Meta tiene la plantilla "${template.name}" en estado ${template.status}; solo se pueden mandar las aprobadas.`,
    };
  }

  const components = componentsOf(template);
  const sendable = templateSendability(components, template.category);
  if (!sendable.ok) return { ok: false, error: sendable.reason };

  const params = templateParamsOf(flow.template_params);
  const vars = templateVariables(components);

  const resolve = (
    tokens: string[],
    source: Record<string, string>,
  ): Record<string, string> =>
    Object.fromEntries(
      tokens.map((token) => [
        token,
        cleanParam(renderTemplate(source[token] ?? "", ctx)),
      ]),
    );

  const values: TemplateVariableValues = {
    header: resolve(vars.header, params.header),
    body: resolve(vars.body, params.body),
  };

  try {
    const payload = buildTemplatePayload({
      name: template.name,
      language: template.language,
      components,
      values,
    });
    return {
      ok: true,
      content: {
        // La burbuja del chat muestra la vista previa renderizada: en la
        // bandeja tiene que verse lo que recibió la clienta, no un payload.
        body: renderTemplatePreview(components, values),
        wa_template: payload as unknown as Json,
      },
    };
  } catch (err) {
    // `buildTemplatePayload` tira cuando una variable quedó vacía — pasa
    // cuando el turno no tiene profesional asignado, por ejemplo. Mandar el
    // parámetro vacío sería un rechazo seguro de Meta.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
