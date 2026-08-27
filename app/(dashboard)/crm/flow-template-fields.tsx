"use client";

import {
  AlertTriangle,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  MessageSquareText,
  MousePointerClick,
  Video,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buttonRepliesOf,
  type ButtonReplyMediaType,
  emptyButtonReply,
  type FlowButtonReply,
  hasContent,
  isSendableReplyMedia,
  normalizeButtonLabel,
} from "@/lib/automations/buttons";
import { createClient } from "@/lib/supabase/client";
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
  quickReplyButtons,
  templateSendability,
  templateVariables,
  type WhatsappTemplateRow,
} from "@/lib/whatsapp-cloud/templates";

/** Identidad de una plantilla en el `<Select>`: name + idioma. */
function templateKey(name: string, language: string): string {
  return `${name}|${language}`;
}

export type FlowVariable = { key: string; label: string };

const EMPTY_PARAMS: TemplateParamsInput = { header: {}, body: {} };

/**
 * Precarga el mapeo de variables cuando se puede deducir.
 *
 * Las plantillas armadas desde Configuración usan los nombres de las variables
 * del CRM —`{{nombre}}`, `{{fecha}}`…— justamente para esto: el mapeo obvio es
 * la identidad y no tiene sentido hacerlo tipear. Las plantillas numeradas
 * (`{{1}}`, `{{2}}`), típicas de las que se crearon en el WhatsApp Manager, no
 * se pueden adivinar y quedan en blanco.
 */
function seedParams(
  template: WhatsappTemplateRow,
  variables: readonly FlowVariable[],
): TemplateParamsInput {
  const known = new Set(variables.map((v) => v.key));
  const vars = templateVariables(componentsOf(template));
  const fill = (tokens: string[]) =>
    Object.fromEntries(
      tokens
        .filter((token) => known.has(token))
        .map((token) => [token, `{{${token}}}`]),
    );
  return { header: fill(vars.header), body: fill(vars.body) };
}

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
  buttonReplies,
  onButtonRepliesChange,
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
  /**
   * Qué contesta el flujo cuando tocan cada botón. Los dos props van juntos y
   * son opcionales: el editor de reseñas no los pasa porque su respuesta la
   * decide el puntaje, no el botón, y mostrar el bloque ahí prometería algo
   * que no va a pasar.
   */
  buttonReplies?: FlowButtonReply[];
  onButtonRepliesChange?: (next: FlowButtonReply[]) => void;
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
  // Solo los de respuesta rápida: los de link y los de llamada no le avisan a
  // Meta cuando se tocan, así que no hay nada que contestar.
  const buttons = quickReplyButtons(components);

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
            No hay plantillas aprobadas disponibles. Se arman en{" "}
            <strong className="text-foreground">
              Configuración → WhatsApp API → Plantillas
            </strong>{" "}
            y aparecen acá cuando Meta las aprueba.
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
                const next = sendable.find(
                  (t) => t.name === name && t.language === language,
                );
                onParamsChange(next ? seedParams(next, variables) : EMPTY_PARAMS);
                // Las respuestas a botones que la plantilla nueva no tiene
                // quedarían inertes en la base; las que se llaman igual se
                // conservan, que es lo que uno espera al corregir la plantilla
                // y volver a elegirla.
                onButtonRepliesChange?.(
                  next ? keepReplies(buttonReplies ?? [], next) : [],
                );
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

              {onButtonRepliesChange && buttons.length > 0 ? (
                <ButtonRepliesSection
                  buttons={buttons}
                  replies={buttonReplies ?? []}
                  onChange={onButtonRepliesChange}
                  variables={variables}
                />
              ) : null}
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
 * Conserva solo las respuestas cuyo botón sigue existiendo en la plantilla
 * elegida. Se compara normalizado por lo mismo que el worker: una plantilla
 * reeditada puede volver con "Confirmar ✅" donde antes decía "Confirmar".
 */
function keepReplies(
  replies: FlowButtonReply[],
  template: WhatsappTemplateRow,
): FlowButtonReply[] {
  const labels = new Set(
    quickReplyButtons(componentsOf(template)).map(normalizeButtonLabel),
  );
  return replies.filter((r) => labels.has(normalizeButtonLabel(r.button)));
}

/** Límites de la Cloud API por tipo de archivo. */
const MEDIA_MAX_MB: Record<ButtonReplyMediaType, number> = {
  image: 5,
  video: 16,
};

const MEDIA_ACCEPT: Record<ButtonReplyMediaType, string> = {
  image: "image/jpeg,image/png",
  video: "video/mp4,video/3gpp",
};

const MEDIA_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
};

/**
 * Qué contesta el flujo cuando la clienta toca cada botón de la plantilla.
 *
 * La gracia está en que la respuesta NO es otra plantilla: el click abre la
 * ventana de 24 h de la Cloud API, así que a partir de ahí se puede mandar
 * texto libre, una imagen o un video, sin pagar otra plantilla ni pedirle
 * permiso a Meta.
 *
 * Un botón sin nada configurado no es un error: significa que ese click lo
 * sigue contestando una persona desde la bandeja, como hasta ahora.
 */
function ButtonRepliesSection({
  buttons,
  replies,
  onChange,
  variables,
}: {
  buttons: string[];
  replies: FlowButtonReply[];
  onChange: (next: FlowButtonReply[]) => void;
  variables: readonly FlowVariable[];
}) {
  function replyFor(button: string): FlowButtonReply {
    const key = normalizeButtonLabel(button);
    return (
      replies.find((r) => normalizeButtonLabel(r.button) === key) ??
      emptyButtonReply(button)
    );
  }

  function update(button: string, patch: Partial<FlowButtonReply>) {
    const key = normalizeButtonLabel(button);
    const exists = replies.some((r) => normalizeButtonLabel(r.button) === key);
    onChange(
      exists
        ? replies.map((r) =>
            normalizeButtonLabel(r.button) === key
              ? // `button` se pisa con el texto actual de la plantilla: si le
                // cambiaron el emoji, la fila guardada se pone al día sola.
                { ...r, ...patch, button }
              : r,
          )
        : [...replies, { ...emptyButtonReply(button), ...patch }],
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <MousePointerClick className="size-4 text-gold" />
        <Label>Qué contestamos cuando toquen cada botón</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        El click de la clienta abre la ventana de 24 h, así que acá sí se puede
        mandar texto libre, una imagen o un video. Los botones que dejes vacíos
        los sigue contestando una persona desde la bandeja.
      </p>

      {buttons.map((button) => (
        <ButtonReplyRow
          key={button}
          button={button}
          reply={replyFor(button)}
          onChange={(patch) => update(button, patch)}
          variables={variables}
        />
      ))}
    </div>
  );
}

function ButtonReplyRow({
  button,
  reply,
  onChange,
  variables,
}: {
  button: string;
  reply: FlowButtonReply;
  onChange: (patch: Partial<FlowButtonReply>) => void;
  variables: readonly FlowVariable[];
}) {
  const [uploading, setUploading] = useState<ButtonReplyMediaType | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  /**
   * Sube el archivo al mismo bucket que usa la bandeja, bajo `outbound/` para
   * caer dentro de las mismas políticas de Storage. El worker lo firma recién
   * al mandarlo, igual que un adjunto cargado a mano.
   *
   * Si después no se guarda el flujo, el archivo queda huérfano en el bucket.
   * Es barato y no se ve desde ningún lado; limpiarlo pediría un borrado
   * transaccional que no vale lo que cuesta.
   */
  async function handleFile(file: File, type: ButtonReplyMediaType) {
    const mime = file.type.split(";")[0]?.toLowerCase() ?? "";

    if (!isSendableReplyMedia(type, mime)) {
      toast.error(
        type === "image"
          ? "WhatsApp solo acepta imágenes JPG o PNG."
          : "WhatsApp solo acepta video MP4 o 3GP.",
      );
      return;
    }
    if (file.size > MEDIA_MAX_MB[type] * 1024 * 1024) {
      toast.error(`El archivo no puede pasar de ${MEDIA_MAX_MB[type]} MB.`);
      return;
    }

    setUploading(type);
    try {
      const supabase = createClient();
      const path = `outbound/automations/${crypto.randomUUID()}.${
        MEDIA_EXT[mime] ?? "bin"
      }`;
      const { error } = await supabase.storage
        .from("wa-media")
        .upload(path, file, { contentType: mime, upsert: false });
      if (error) throw new Error(error.message);

      onChange({
        media_type: type,
        media_url: path,
        media_mime: mime,
        media_filename: file.name || null,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No pudimos subir el archivo.",
      );
    } finally {
      setUploading(null);
    }
  }

  const hasMedia = Boolean(reply.media_url);

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/10 p-2.5">
      <Badge variant="outline" className="text-[11px]">
        {button}
      </Badge>

      <Textarea
        rows={2}
        value={reply.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder={
          hasMedia
            ? "Epígrafe del archivo (opcional)"
            : "¡Listo {{nombre}}! Te esperamos 💛"
        }
      />

      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange({ body: `${reply.body}{{${v.key}}}` })}
            className="inline-flex items-center rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-mono transition-colors hover:bg-muted"
            title={v.label}
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>

      <input
        ref={imageRef}
        type="file"
        accept={MEDIA_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file, "image");
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept={MEDIA_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file, "video");
        }}
      />

      {hasMedia ? (
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
          {reply.media_type === "video" ? (
            <Video className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">
            {reply.media_filename ?? reply.media_url}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-6 shrink-0"
            onClick={() =>
              onChange({
                media_type: null,
                media_url: null,
                media_mime: null,
                media_filename: null,
              })
            }
            title="Sacar el archivo"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={uploading !== null}
            onClick={() => imageRef.current?.click()}
          >
            {uploading === "image" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImageIcon className="size-3.5" />
            )}
            Imagen
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={uploading !== null}
            onClick={() => videoRef.current?.click()}
          >
            {uploading === "video" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Video className="size-3.5" />
            )}
            Video
          </Button>
        </div>
      )}
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
  button_replies?: unknown;
}): string | null {
  if (flow.send_mode !== "template") return null;

  const base = `Plantilla ${flow.template_name ?? "?"} (${flow.template_language ?? "?"})`;
  // Que un flujo conteste solo los botones cambia bastante lo que hace, y
  // hasta ahora eso solo se veía abriendo el editor.
  const answered = buttonRepliesOf(flow.button_replies).filter(hasContent).length;
  if (answered === 0) return base;
  return `${base} · ${answered} botón${answered === 1 ? "" : "es"} con respuesta`;
}
