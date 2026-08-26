"use client";

import {
  AlertTriangle,
  Info,
  Link2,
  Loader2,
  Phone,
  Plus,
  Reply,
  Save,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { TEMPLATE_VARIABLES } from "@/lib/validations/crm-config";
import {
  componentsToDraft,
  draftPlaceholders,
  emptyTemplateDraft,
  normalizeTemplateName,
  suggestedExample,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  TEMPLATE_LIMITS,
  validateTemplateDraft,
  type TemplateButtonDraft,
  type TemplateDraft,
} from "@/lib/whatsapp-cloud/template-draft";
import type { TemplateComponent } from "@/lib/whatsapp-cloud/templates";
import {
  createWhatsappTemplateAction,
  updateWhatsappTemplateAction,
} from "./whatsapp-cloud-actions";

export type EditableTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: TemplateComponent[];
};

/**
 * Las variables que el CRM sabe rellenar al disparar un flujo. Se ofrecen como
 * nombre de placeholder —`{{nombre}}`, no `{{1}}`— a propósito: Meta acepta
 * plantillas con parámetros nombrados, y así el editor de automatizaciones
 * puede mapear cada variable sola en vez de hacer adivinar cuál era `{{2}}`.
 * `salon` no está en la lista de los flujos comunes pero sí en las reseñas.
 */
const VARIABLE_CHIPS = [
  ...TEMPLATE_VARIABLES,
  { key: "salon", label: "Nombre del salón" },
] as const;

/**
 * Editor de plantillas de Meta dentro del CRM.
 *
 * Antes había que armarlas en el WhatsApp Manager y volver acá a sincronizar.
 * Esto hace las dos cosas: manda la plantilla al WABA y la deja cacheada en
 * `PENDING`. La aprobación sigue siendo de Meta y tarda lo que tarda; lo que
 * se evita es el ida y vuelta entre dos paneles, y sobre todo los rechazos
 * tontos (ejemplos faltantes, variables salteadas) que acá se ven antes de
 * mandar.
 */
export function WhatsappTemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = plantilla nueva. */
  template: EditableTemplate | null;
}) {
  const initial = useMemo<TemplateDraft>(
    () => (template ? componentsToDraft(template) : emptyTemplateDraft()),
    [template],
  );
  // La key del <Dialog> en el panel remonta el editor por plantilla, así que
  // alcanza con inicializar el estado una vez.
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [isPending, startTransition] = useTransition();

  const headerRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState<"header" | "body">("body");

  const vars = draftPlaceholders(draft);
  const { errors, warnings } = validateTemplateDraft(draft);

  function patch(changes: Partial<TemplateDraft>) {
    setDraft((prev) => {
      const next = { ...prev, ...changes };
      // Una variable recién escrita estrena ejemplo sugerido: sin ejemplo Meta
      // no revisa la plantilla, y pedirlo en blanco es una traba de más.
      for (const token of draftPlaceholders(next).all) {
        if (next.examples[token] === undefined) {
          next.examples = {
            ...next.examples,
            [token]: suggestedExample(token),
          };
        }
      }
      return next;
    });
  }

  /** Inserta `{{clave}}` donde está el cursor del último campo tocado. */
  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const el = focused === "header" ? headerRef.current : bodyRef.current;
    const current = focused === "header" ? draft.header : draft.body;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    patch(focused === "header" ? { header: next } : { body: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function submit() {
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    startTransition(async () => {
      const result = template
        ? await updateWhatsappTemplateAction(template.id, draft)
        : await createWhatsappTemplateAction(draft);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        template
          ? "Plantilla actualizada. Vuelve a revisión de Meta."
          : "Plantilla enviada a Meta. Queda pendiente hasta que la aprueben.",
      );
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Editar plantilla" : "Nueva plantilla"}
          </DialogTitle>
          <DialogDescription>
            Se crea en el WhatsApp Manager de Meta y queda pendiente de
            aprobación. Suele tardar minutos; el estado se actualiza solo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          {/* Formulario */}
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl_name" className="text-xs">
                  Nombre
                </Label>
                <Input
                  id="tpl_name"
                  value={draft.name}
                  disabled={Boolean(template)}
                  onChange={(e) =>
                    patch({ name: normalizeTemplateName(e.target.value) })
                  }
                  placeholder="recordatorio_de_turno"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  {template
                    ? "Meta no deja renombrar una plantilla."
                    : "Interno: la clienta no lo ve. Solo minúsculas y guiones bajos."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Idioma</Label>
                <Select
                  value={draft.language}
                  disabled={Boolean(template)}
                  onValueChange={(language) => patch({ language })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Categoría</Label>
              <Select
                value={draft.category}
                onValueChange={(category) =>
                  patch({ category: category as TemplateDraft["category"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {
                  TEMPLATE_CATEGORIES.find((c) => c.value === draft.category)
                    ?.hint
                }
              </p>
            </div>

            <Field
              label="Cabecera"
              hint="Opcional. Una línea en negrita arriba del mensaje."
              count={`${draft.header.length}/${TEMPLATE_LIMITS.header}`}
            >
              <Input
                ref={headerRef}
                value={draft.header}
                onChange={(e) => patch({ header: e.target.value })}
                onFocus={() => setFocused("header")}
                maxLength={TEMPLATE_LIMITS.header}
                placeholder="Tu turno en Zenna"
              />
            </Field>

            <Field
              label="Mensaje"
              hint="Lo que lee la clienta. Insertá variables con los botones de abajo."
              count={`${draft.body.length}/${TEMPLATE_LIMITS.body}`}
            >
              <Textarea
                ref={bodyRef}
                value={draft.body}
                onChange={(e) => patch({ body: e.target.value })}
                onFocus={() => setFocused("body")}
                maxLength={TEMPLATE_LIMITS.body}
                rows={5}
                placeholder="Hola {{nombre}}, te recordamos tu turno del {{fecha}} a las {{hora}} con {{profesional}}. Te esperamos!"
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {VARIABLE_CHIPS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVariable(v.key)}
                    title={`${v.label} — se inserta en ${focused === "header" ? "la cabecera" : "el mensaje"}`}
                    className="inline-flex items-center rounded-full border bg-muted/30 px-2 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Pie"
              hint="Opcional, gris y chiquito. Sin variables."
              count={`${draft.footer.length}/${TEMPLATE_LIMITS.footer}`}
            >
              <Input
                value={draft.footer}
                onChange={(e) => patch({ footer: e.target.value })}
                maxLength={TEMPLATE_LIMITS.footer}
                placeholder="Zenna · Respondé este mensaje para cambiarlo"
              />
            </Field>

            {/* Ejemplos: Meta no revisa una plantilla sin ellos. */}
            {vars.all.length > 0 ? (
              <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">
                    Meta necesita un ejemplo de cada variable para poder
                    revisarla. No es lo que se manda: al disparar el flujo se
                    reemplaza por los datos del turno.
                  </p>
                </div>
                {vars.all.map((token) => (
                  <div key={token} className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="shrink-0 font-mono text-[10px]"
                    >
                      {`{{${token}}}`}
                    </Badge>
                    <Input
                      value={draft.examples[token] ?? ""}
                      onChange={(e) =>
                        patch({
                          examples: {
                            ...draft.examples,
                            [token]: e.target.value,
                          },
                        })
                      }
                      className="h-8 text-xs"
                      placeholder={suggestedExample(token)}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <ButtonsEditor
              buttons={draft.buttons}
              onChange={(buttons) => patch({ buttons })}
            />

            {errors.length > 0 || warnings.length > 0 ? (
              <div className="space-y-2">
                {errors.length > 0 ? (
                  <Notice tone="error" items={errors} />
                ) : null}
                {warnings.length > 0 ? (
                  <Notice tone="warning" items={warnings} />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Vista previa */}
          <div className="space-y-2 md:sticky md:top-0 md:self-start">
            <Label className="text-xs text-muted-foreground">
              Así la va a ver la clienta
            </Label>
            <Preview draft={draft} />
            <p className="text-[11px] text-muted-foreground">
              Con los valores de ejemplo.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isPending || errors.length > 0}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {template ? "Guardar y reenviar a revisión" : "Crear plantilla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  count,
  children,
}: {
  label: string;
  hint: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {children}
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Notice({
  tone,
  items,
}: {
  tone: "error" | "warning";
  items: string[];
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "error"
          ? "border-rose-300 bg-rose-50 text-rose-900"
          : "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const BUTTON_LABELS: Record<TemplateButtonDraft["type"], string> = {
  QUICK_REPLY: "Respuesta rápida",
  URL: "Abrir link",
  PHONE_NUMBER: "Llamar",
};

function ButtonsEditor({
  buttons,
  onChange,
}: {
  buttons: TemplateButtonDraft[];
  onChange: (buttons: TemplateButtonDraft[]) => void;
}) {
  function add(type: TemplateButtonDraft["type"]) {
    const base = { text: "" };
    onChange([
      ...buttons,
      type === "URL"
        ? { type, ...base, url: "" }
        : type === "PHONE_NUMBER"
          ? { type, ...base, phone_number: "" }
          : { type, ...base },
    ]);
  }

  function update(index: number, changes: Partial<TemplateButtonDraft>) {
    onChange(
      buttons.map((button, i) =>
        i === index ? ({ ...button, ...changes } as TemplateButtonDraft) : button,
      ),
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs">Botones</Label>
          <p className="text-[11px] text-muted-foreground">
            Opcionales. Una respuesta rápida entra como mensaje de la clienta y
            abre la ventana de 24 h.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={buttons.length >= TEMPLATE_LIMITS.buttons}
            >
              <Plus className="size-4" />
              Agregar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => add("QUICK_REPLY")}>
              <Reply className="size-4" />
              Respuesta rápida
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => add("URL")}>
              <Link2 className="size-4" />
              Abrir link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => add("PHONE_NUMBER")}>
              <Phone className="size-4" />
              Llamar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {buttons.map((button, i) => (
        <div
          key={i}
          className="space-y-2 rounded-md border bg-muted/10 p-2"
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {BUTTON_LABELS[button.type]}
            </Badge>
            <Input
              value={button.text}
              onChange={(e) => update(i, { text: e.target.value })}
              maxLength={TEMPLATE_LIMITS.buttonText}
              placeholder="Texto del botón"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(buttons.filter((_, j) => j !== i))}
              className="shrink-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {button.type === "URL" ? (
            <Input
              value={button.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…"
              className="h-8 text-xs"
            />
          ) : null}
          {button.type === "PHONE_NUMBER" ? (
            <Input
              value={button.phone_number}
              onChange={(e) => update(i, { phone_number: e.target.value })}
              placeholder="+54 9 11 5555 5555"
              className="h-8 text-xs"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Burbuja de WhatsApp con los ejemplos ya reemplazados. */
function Preview({ draft }: { draft: TemplateDraft }) {
  function fill(text: string): string {
    return text.replace(
      /\{\{\s*([0-9]+|[a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (raw, token: string) => draft.examples[token]?.trim() || raw,
    );
  }

  return (
    <div className="rounded-lg bg-[#e5ddd5] p-3">
      <div className="space-y-1.5 rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
        {draft.header.trim() ? (
          <p className="text-xs font-semibold break-words">
            {fill(draft.header)}
          </p>
        ) : null}
        <p className="text-xs whitespace-pre-wrap break-words text-stone-800">
          {draft.body.trim() ? (
            fill(draft.body)
          ) : (
            <span className="text-stone-400">El mensaje va acá…</span>
          )}
        </p>
        {draft.footer.trim() ? (
          <p className="text-[10px] text-stone-500 break-words">
            {draft.footer}
          </p>
        ) : null}
      </div>
      {draft.buttons.length > 0 ? (
        <div className="mt-1 space-y-1">
          {draft.buttons.map((button, i) => (
            <div
              key={i}
              className="rounded-lg bg-white px-3 py-1.5 text-center text-xs font-medium text-sky-600 shadow-sm"
            >
              {button.text.trim() || "Botón"}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
