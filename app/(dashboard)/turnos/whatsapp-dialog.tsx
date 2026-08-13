"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  messageClientAction,
  openClientConversationAction,
} from "../crm/actions";
import { capitalize, firstName, servicesLabel } from "./appointment-utils";
import type { AppointmentWithRelations } from "./types";

type Template = { label: string; body: string };

/**
 * Los tres mensajes que el salón manda todo el tiempo desde la agenda, ya
 * armados con los datos del turno. El texto se puede tocar antes de mandarlo:
 * son un punto de partida, no un formulario.
 */
function templatesFor(appointment: AppointmentWithRelations): Template[] {
  const start = new Date(appointment.starts_at);
  const name = appointment.clients?.full_name
    ? firstName(appointment.clients.full_name)
    : "";
  const hola = name ? `¡Hola ${name}!` : "¡Hola!";
  const day = capitalize(format(start, "EEEE d 'de' MMMM", { locale: es }));
  const time = format(start, "HH:mm");
  const services = servicesLabel(appointment);
  const forServices = services ? ` para ${services}` : "";

  return [
    {
      label: "Recordatorio",
      body: `${hola} Te recordamos tu turno del ${day.toLowerCase()} a las ${time}${forServices}. ¿Nos confirmás? 💕`,
    },
    {
      label: "Demora",
      body: `${hola} Estamos con una demora con el turno de las ${time}. Te avisamos apenas estemos listas 🙏`,
    },
    {
      label: "Reprogramar",
      body: `${hola} ¿Cómo estás? Necesitamos mover tu turno del ${day.toLowerCase()} a las ${time}. ¿Qué día te queda cómodo?`,
    },
  ];
}

/**
 * "Mandarle un WhatsApp" desde el turnero.
 *
 * Sale por el WhatsApp del salón —el mismo de la bandeja— y no por un enlace
 * wa.me: así la respuesta de la clienta cae en el CRM y queda toda la charla
 * en un solo lugar. Si nunca hubo chat con ella, se abre uno.
 */
export function WhatsAppDialog({
  appointment,
  onOpenChange,
}: {
  /** Turno al que le mandamos el mensaje. `null` mantiene todo cerrado. */
  appointment: AppointmentWithRelations | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  const templates = useMemo(
    () => (appointment ? templatesFor(appointment) : []),
    [appointment],
  );

  // Cada turno arranca con el recordatorio puesto, que es el mensaje que se
  // manda nueve de cada diez veces. Se recalcula durante el render al cambiar
  // de turno: en un efecto, el diálogo abriría un frame con el texto del turno
  // anterior.
  const [lastAppointmentId, setLastAppointmentId] = useState(
    appointment?.id ?? null,
  );
  if ((appointment?.id ?? null) !== lastAppointmentId) {
    setLastAppointmentId(appointment?.id ?? null);
    setBody(templates[0]?.body ?? "");
  }

  const client = appointment?.clients ?? null;
  const phone = client?.phone ?? null;
  const digits = (phone ?? "").replace(/\D/g, "");
  const canSend = digits.length >= 8 && body.trim().length > 0;

  function close() {
    onOpenChange(false);
  }

  function send() {
    if (!appointment || !canSend) return;
    const text = body;
    startTransition(async () => {
      const result = await messageClientAction({
        clientId: client?.id ?? null,
        phone,
        displayName: client?.full_name ?? null,
        body: text,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const conversationId = result.conversationId;
      toast.success("Mensaje enviado por WhatsApp.", {
        action: conversationId
          ? {
              label: "Ver chat",
              onClick: () => router.push(`/crm?c=${conversationId}`),
            }
          : undefined,
      });
      close();
    });
  }

  function openChat() {
    if (!appointment) return;
    startTransition(async () => {
      const result = await openClientConversationAction({
        clientId: client?.id ?? null,
        phone,
        displayName: client?.full_name ?? null,
      });
      if (result.error || !result.conversationId) {
        toast.error(result.error ?? "No pudimos abrir el chat.");
        return;
      }
      router.push(`/crm?c=${result.conversationId}`);
    });
  }

  return (
    <Dialog
      open={!!appointment}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            WhatsApp a {client?.full_name ?? "la clienta"}
          </DialogTitle>
          <DialogDescription>
            {digits.length >= 8
              ? `Sale desde el WhatsApp del salón al ${phone}. La respuesta llega a la bandeja de mensajes.`
              : "Esta clienta no tiene un teléfono válido cargado en su ficha. Agregalo desde Clientas para poder escribirle."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {templates.map((template) => {
            const active = body === template.body;
            return (
              <button
                key={template.label}
                type="button"
                onClick={() => setBody(template.body)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-[0.8125rem] transition-colors",
                  active
                    ? "border-accent bg-accent font-medium text-accent-foreground"
                    : "border-input text-muted-foreground hover:bg-muted",
                )}
              >
                {template.label}
              </button>
            );
          })}
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Escribí el mensaje…"
          aria-label="Mensaje"
        />

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={openChat}
            disabled={digits.length < 8 || isPending}
            className="sm:mr-auto"
          >
            <ExternalLink className="size-4" />
            Abrir chat
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cerrar
            </Button>
            <Button type="button" onClick={send} disabled={!canSend || isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
