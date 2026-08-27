"use client";

import { ChevronLeft, LayoutTemplate, Loader2, Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  componentsOf,
  renderTemplatePreview,
  templateSendability,
  templateVariables,
  type TemplateVariableValues,
  type WhatsappTemplateRow,
} from "@/lib/whatsapp-cloud/templates";
import { sendTemplateMessageAction } from "./actions";

/**
 * Selector de plantillas de la Cloud API para el canal `whatsapp_cloud`.
 *
 * Es el único camino para escribirle a alguien fuera de la ventana de 24 h,
 * así que el botón vive siempre en el composer de esos chats: dos pasos
 * (elegir plantilla → completar variables) y una vista previa de lo que va a
 * recibir la clienta antes de mandar.
 */
export function TemplatePicker({
  templates,
  conversationId,
  disabled,
  prominent,
  open: openProp,
  onOpenChange,
}: {
  templates: WhatsappTemplateRow[];
  conversationId: string;
  disabled?: boolean;
  /** Con la ventana cerrada el botón pasa a ser la acción principal. */
  prominent?: boolean;
  /**
   * Modo controlado, sin botón propio: lo usa la burbuja de un mensaje que
   * rebotó por la ventana de 24 h, que ofrece el "Enviar plantilla" en el
   * lugar donde se ve el problema y abre este mismo diálogo desde afuera.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? openProp : uncontrolledOpen;
  const setOpen = controlled
    ? (next: boolean) => onOpenChange?.(next)
    : setUncontrolledOpen;
  const [selected, setSelected] = useState<WhatsappTemplateRow | null>(null);
  const [values, setValues] = useState<TemplateVariableValues>({
    header: {},
    body: {},
  });
  const [isPending, startTransition] = useTransition();

  const approved = useMemo(
    () => templates.filter((t) => t.status.toUpperCase() === "APPROVED"),
    [templates],
  );

  const selectedComponents = selected ? componentsOf(selected) : [];
  const vars = selected
    ? templateVariables(selectedComponents)
    : { header: [], body: [] };
  const allFilled =
    vars.header.every((t) => values.header[t]?.trim()) &&
    vars.body.every((t) => values.body[t]?.trim());

  function reset() {
    setSelected(null);
    setValues({ header: {}, body: {} });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function pick(template: WhatsappTemplateRow) {
    setSelected(template);
    setValues({ header: {}, body: {} });
  }

  function handleSend() {
    if (!selected) return;
    startTransition(async () => {
      const result = await sendTemplateMessageAction({
        conversationId,
        templateId: selected.id,
        values,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Plantilla encolada.");
      handleOpenChange(false);
    });
  }

  if (approved.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {controlled ? null : prominent ? (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-full bg-[var(--wa-accent)] text-white hover:bg-[var(--wa-accent-strong)]"
        >
          <LayoutTemplate className="size-4" />
          Enviar plantilla
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Plantillas de WhatsApp"
          title="Plantillas de WhatsApp"
          onClick={() => setOpen(true)}
        >
          <LayoutTemplate className="size-4" />
        </Button>
      )}

      <DialogContent className="sm:max-w-md">
        {!selected ? (
          <>
            <DialogHeader>
              <DialogTitle>Plantillas de WhatsApp</DialogTitle>
              <DialogDescription>
                Mensajes aprobados por Meta. Son los únicos que se pueden mandar
                con la ventana de 24 h cerrada.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {approved.map((t) => {
                const sendable = templateSendability(componentsOf(t), t.category);
                const bodyText =
                  componentsOf(t).find(
                    (c) => c.type?.toUpperCase() === "BODY",
                  )?.text ?? "";
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!sendable.ok}
                    onClick={() => pick(t)}
                    title={sendable.ok ? undefined : sendable.reason}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      sendable.ok
                        ? "hover:bg-accent"
                        : "cursor-not-allowed opacity-50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium font-mono text-xs">
                        {t.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {t.language}
                      </Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {sendable.ok ? bodyText : sendable.reason}
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Volver a la lista de plantillas"
                  className="grid size-7 place-items-center rounded-full hover:bg-accent"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="min-w-0 truncate font-mono text-sm">
                  {selected.name}
                </span>
              </DialogTitle>
              <DialogDescription>
                {vars.header.length + vars.body.length > 0
                  ? "Completá las variables y revisá cómo lo va a recibir."
                  : "Así lo va a recibir la clienta."}
              </DialogDescription>
            </DialogHeader>

            {vars.header.length > 0 || vars.body.length > 0 ? (
              <div className="space-y-2.5">
                {vars.header.map((token) => (
                  <div key={`h-${token}`} className="space-y-1">
                    <Label className="text-xs">
                      Cabecera · {`{{${token}}}`}
                    </Label>
                    <Input
                      value={values.header[token] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          header: { ...v.header, [token]: e.target.value },
                        }))
                      }
                      placeholder="Valor"
                    />
                  </div>
                ))}
                {vars.body.map((token) => (
                  <div key={`b-${token}`} className="space-y-1">
                    <Label className="text-xs">{`{{${token}}}`}</Label>
                    <Input
                      value={values.body[token] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          body: { ...v.body, [token]: e.target.value },
                        }))
                      }
                      placeholder="Valor"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {/* Vista previa con las variables puestas (o los {{n}} pelados). */}
            <div className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {renderTemplatePreview(selectedComponents, values)}
            </div>

            <Button
              type="button"
              onClick={handleSend}
              disabled={isPending || !allFilled}
              className="w-full"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar plantilla
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
