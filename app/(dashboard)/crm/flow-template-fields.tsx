"use client";

import { AlertTriangle, LayoutTemplate, MessageSquareText } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type AutomationSendMode,
  type TemplateParamsInput,
} from "@/lib/validations/crm-config";
import {
  componentsOf,
  footerComponent,
  headerComponent,
  bodyComponent,
  templateSendability,
  templateVariables,
  type WhatsappTemplateRow,
} from "@/lib/whatsapp-cloud/templates";

/** Identidad de una plantilla en el `<Select>`: name + idioma. */
function templateKey(name: string, language: string): string {
  return `${name}|${language}`;
}

export type FlowVariable = { key: string; label: string };

/**
 * El bloque "cómo sale este mensaje" que comparten el editor de flujos y el de
 * pedidos de reseña.
 *
 * Existe porque después de la migración de número las automatizaciones salen
 * por la Cloud API, donde el texto libre solo llega dentro de las 24 h del
 * último mensaje de la clienta. Un recordatorio de turno casi nunca cae ahí
 * adentro: para que llegue tiene que ser una plantilla aprobada por Meta.
 *
 * Es un componente controlado a propósito — los dos editores manejan su estado
 * de forma distinta (uno con react-hook-form, el otro con useState) y meter un
 * formulario adentro obligaría a uno de los dos a cambiar de mecánica.
 */
export function FlowTemplateFields({
  templates,
  sendMode,
  onSendModeChange,
  templateName,
  templateLanguage,
  onTemplateChange,
  params,
  onParamsChange,
  variables,
  freeTextNote,
  error,
}: {
  /** Las plantillas cacheadas del WABA (la página ya filtra las aprobadas). */
  templates: WhatsappTemplateRow[];
  sendMode: AutomationSendMode;
  onSendModeChange: (mode: AutomationSendMode) => void;
  templateName: string;
  templateLanguage: string;
  onTemplateChange: (name: string, language: string) => void;
  params: TemplateParamsInput;
  onParamsChange: (params: TemplateParamsInput) => void;
  /** Las variables del CRM que este flujo sabe rellenar. */
  variables: readonly FlowVariable[];
  /** Aclaración propia del editor para el modo "mensaje libre". */
  freeTextNote?: string;
  error?: string;
}) {
  // Solo se ofrecen las que el CRM sabe armar: una cabecera con imagen o un
  // botón con URL variable necesitan parámetros que todavía no pedimos, y
  // elegirlas terminaría en un rechazo 132000 de Meta al primer turno.
  const sendable = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.status.toUpperCase() === "APPROVED" &&
          templateSendability(componentsOf(t), t.category).ok,
      ),
    [templates],
  );

  const selected = useMemo(
    () =>
      sendable.find(
        (t) => t.name === templateName && t.language === templateLanguage,
      ) ?? null,
    [sendable, templateName, templateLanguage],
  );

  const components = selected ? componentsOf(selected) : [];
  const vars = selected
    ? templateVariables(components)
    : { header: [], body: [] };

  function setParam(
    section: "header" | "body",
    token: string,
    value: string,
  ) {
    onParamsChange({
      ...params,
      [section]: { ...params[section], [token]: value },
    });
  }

  /** Vista previa con los placeholders ya reemplazados por lo configurado. */
  function preview(text: string, section: "header" | "body"): string {
    return text.replace(
      /\{\{\s*([0-9]+|[a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (raw, token: string) => params[section][token]?.trim() || raw,
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
      <div className="space-y-1.5">
        <Label>Cómo se manda</Label>
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={sendMode === "text"}
            onClick={() => onSendModeChange("text")}
            icon={<MessageSquareText className="size-4" />}
            title="Mensaje libre"
            subtitle="Solo llega dentro de las 24 h"
          />
          <ModeButton
            active={sendMode === "template"}
            onClick={() => onSendModeChange("template")}
            icon={<LayoutTemplate className="size-4" />}
            title="Plantilla aprobada"
            subtitle="Llega siempre"
          />
        </div>
      </div>

      {sendMode === "text" ? (
        <p className="text-xs text-muted-foreground">
          {freeTextNote ??
            "WhatsApp solo acepta texto libre dentro de las 24 h posteriores al último mensaje de la clienta. Fuera de esa ventana el envío se rechaza y queda marcado en rojo en el chat."}
        </p>
      ) : sendable.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            No hay plantillas aprobadas disponibles. Se crean en el WhatsApp
            Manager de Meta y se traen desde{" "}
            <strong className="text-foreground">
              Configuración → WhatsApp API → Sincronizar plantillas
            </strong>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Plantilla</Label>
            <Select
              value={
                selected ? templateKey(selected.name, selected.language) : ""
              }
              onValueChange={(value) => {
                const [name, language] = value.split("|");
                onTemplateChange(name ?? "", language ?? "");
                // Los placeholders de una plantilla no significan lo mismo que
                // los de otra: arrastrar los valores viejos pondría el nombre
                // de la clienta donde ahora va la fecha.
                onParamsChange({ header: {}, body: {} });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Elegí una plantilla aprobada" />
              </SelectTrigger>
              <SelectContent>
                {sendable.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={templateKey(t.name, t.language)}
                  >
                    {t.name}{" "}
                    <span className="text-muted-foreground">
                      ({t.language})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>

          {selected ? (
            <>
              {vars.header.length + vars.body.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Esta plantilla no tiene variables: se manda tal cual.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label>Qué va en cada variable</Label>
                  <p className="text-xs text-muted-foreground">
                    Click en una variable del CRM para insertarla. También se
                    puede escribir texto fijo.
                  </p>
                  {vars.header.map((token) => (
                    <ParamField
                      key={`h-${token}`}
                      token={token}
                      section="Cabecera"
                      value={params.header[token] ?? ""}
                      onChange={(v) => setParam("header", token, v)}
                      variables={variables}
                    />
                  ))}
                  {vars.body.map((token) => (
                    <ParamField
                      key={`b-${token}`}
                      token={token}
                      section="Cuerpo"
                      value={params.body[token] ?? ""}
                      onChange={(v) => setParam("body", token, v)}
                      variables={variables}
                    />
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Vista previa
                </Label>
                <div className="rounded-md bg-background px-3 py-2 text-xs whitespace-pre-wrap">
                  {[
                    headerComponent(components)?.format?.toUpperCase() === "TEXT"
                      ? preview(headerComponent(components)?.text ?? "", "header")
                      : null,
                    preview(bodyComponent(components)?.text ?? "", "body"),
                    footerComponent(components)?.text ?? null,
                  ]
                    .filter(Boolean)
                    .join("\n\n")}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Las variables del CRM se reemplazan recién al disparar el
                  flujo, con los datos del turno.
                </p>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
        active
          ? "border-gold bg-gold/10"
          : "bg-background hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </button>
  );
}

function ParamField({
  token,
  section,
  value,
  onChange,
  variables,
}: {
  token: string;
  section: string;
  value: string;
  onChange: (value: string) => void;
  variables: readonly FlowVariable[];
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {`{{${token}}}`}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{section}</span>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{{nombre}}"
      />
      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(`${value}{{${v.key}}}`)}
            className="inline-flex items-center rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-mono transition-colors hover:bg-muted"
            title={v.label}
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Texto de una línea que resume cómo sale un flujo, para la tarjeta del panel.
 * Vive acá y no en el manager porque depende de la misma forma de los datos
 * que edita este bloque.
 */
export function describeSendMode(flow: {
  send_mode: string;
  template_name: string | null;
  template_language: string | null;
}): string | null {
  if (flow.send_mode !== "template") return null;
  return `Plantilla ${flow.template_name ?? "?"} (${flow.template_language ?? "?"})`;
}
