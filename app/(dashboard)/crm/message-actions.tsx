"use client";

import { ChevronDown, Copy, Forward, Pencil, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { deleteMessageAction } from "./actions";
import type { MessageRow } from "./types";

/** La misma ventana que respeta WhatsApp para editar. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function canEditMessage(message: MessageRow, channel: string): boolean {
  return (
    message.direction === "outbound" &&
    message.type === "text" &&
    channel === "whatsapp" &&
    !message.revoked_at &&
    !!message.external_id &&
    Date.now() - new Date(message.sent_at).getTime() < EDIT_WINDOW_MS
  );
}

/**
 * Menú de una burbuja, el del chevron de WhatsApp Web.
 *
 * En el teléfono queda tenue pero visible en vez de esconderse hasta el hover:
 * sin mouse no hay hover, y una acción que sólo existe en el escritorio no
 * existe — la app del celular es la que más se usa.
 */
export function MessageActions({
  message,
  channel,
  onEdit,
  onForward,
  alignEnd,
}: {
  message: MessageRow;
  channel: string;
  onEdit: () => void;
  onForward: () => void;
  /** El menú de las burbujas salientes se alinea a la derecha. */
  alignEnd?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * Al cerrarse, el menú de Radix devuelve el foco a su disparador. Editar
   * necesita lo contrario —el cursor tiene que quedar en el campo de
   * escritura, listo para corregir—, así que en ese caso le pedimos que no lo
   * haga. Para el resto de las acciones el comportamiento normal es el bueno.
   */
  const keepFocusOut = useRef(false);

  const isOutbound = message.direction === "outbound";
  const revoked = !!message.revoked_at;
  const canEdit = canEditMessage(message, channel);
  const canDelete = isOutbound && !revoked;
  const canCopy = !revoked && !!message.body?.trim();
  const canForward =
    !revoked &&
    message.type !== "reaction" &&
    (message.type === "text"
      ? !!message.body?.trim()
      : !!message.media_url);

  // Sin external_id nunca salió: el botón es "cancelar envío" y no hace falta
  // confirmar nada, no lo vio nadie.
  const neverSent = !message.external_id;

  if (!canEdit && !canDelete && !canCopy && !canForward) return null;

  function runDelete() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await deleteMessageAction(message.id);
      if (result.error) toast.error(result.error);
      else if (result.cancelled) toast.success("Cancelaste el envío.");
      else toast.success("Mensaje eliminado para todos.");
    });
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(message.body ?? "");
      toast.success("Texto copiado.");
    } catch {
      toast.error("El navegador no dejó copiar el texto.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isPending}
            className={cn(
              "size-6 text-[var(--wa-icon)] transition-opacity",
              "opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100",
              "md:opacity-0",
            )}
            aria-label="Opciones del mensaje"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={alignEnd ? "end" : "start"}
          className="w-48"
          onCloseAutoFocus={(event) => {
            if (!keepFocusOut.current) return;
            keepFocusOut.current = false;
            event.preventDefault();
          }}
        >
          {canForward ? (
            <DropdownMenuItem onSelect={onForward}>
              <Forward className="size-4" />
              Reenviar
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem
              onSelect={() => {
                keepFocusOut.current = true;
                onEdit();
              }}
            >
              <Pencil className="size-4" />
              Editar
            </DropdownMenuItem>
          ) : null}
          {canCopy ? (
            <DropdownMenuItem onSelect={() => void copyBody()}>
              <Copy className="size-4" />
              Copiar
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (neverSent) runDelete();
                  else setConfirmOpen(true);
                }}
              >
                <Trash2 className="size-4" />
                {neverSent ? "Cancelar envío" : "Eliminar"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar este mensaje?</DialogTitle>
            <DialogDescription>
              Se borra para vos y para la clienta. En su teléfono queda el aviso
              de que se eliminó un mensaje, igual que en WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
            >
              No, dejalo
            </Button>
            <Button type="button" variant="destructive" onClick={runDelete}>
              Eliminar para todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
