"use client";

import { Download, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { applySurcharge } from "@/lib/validations/budgets";
import type { ServiceRow } from "../turnos/types";
import { sendMediaMessageAction } from "./actions";
import { createBudgetAction } from "./budget-actions";
import {
  budgetImageFilename,
  budgetPdfFilename,
  buildBudgetImage,
  buildBudgetPdf,
  type BudgetPdfPayload,
} from "./budget-pdf";
import type { PaymentMethod } from "./config-types";
import type { ConversationWithClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithClient | null;
  services: ServiceRow[];
  paymentMethods: PaymentMethod[];
};

function jidToPhone(
  jid: string,
  waPhone?: string | null,
): string | null {
  if (jid.endsWith("@lid")) {
    const d = (waPhone ?? "").replace(/\D/g, "");
    return d.length >= 8 ? `+${d}` : null;
  }
  const digits = jid.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!digits || digits.length < 8) {
    const fallback = (waPhone ?? "").replace(/\D/g, "");
    return fallback.length >= 8 ? `+${fallback}` : null;
  }
  return `+${digits}`;
}

type DraftItem = {
  // Stable client-side key so React doesn't re-mount inputs on every keystroke.
  key: string;
  serviceId: string | null;
  serviceName: string;
  priceMin: number;
  priceMax: number;
};

function makeItemFromService(service: ServiceRow): DraftItem {
  const base = Number(service.price) || 0;
  // The salon charges in a range that depends on hair length. We seed the
  // range as ±10% around the catalog price, rounded to multiples of 100 so
  // the receptionist always lands on a familiar-looking number.
  const min = Math.max(0, Math.round((base * 0.9) / 100) * 100);
  const max = Math.max(min, Math.round((base * 1.1) / 100) * 100);
  return {
    key: crypto.randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    priceMin: min || base,
    priceMax: max || base,
  };
}

/**
 * Dialog for generating a salon budget from a WhatsApp conversation.
 *
 * Flow:
 *   1. Receptionist picks one or more services. Each one ships with a
 *      suggested min/max range that they can override (hair length =
 *      variable price).
 *   2. They tick the payment methods they want offered (with editable
 *      surcharges — useful for one-off "tarjeta sin recargo" deals).
 *   3. We persist the budget snapshot to the DB and render a PDF via
 *      jsPDF. The user can download the PDF and/or attach it to the
 *      chat as a document (which the WhatsApp worker forwards normally).
 */
export function PresupuestoDialog({
  open,
  onOpenChange,
  conversation,
  services,
  paymentMethods,
}: Props) {
  // Pre-fill name/phone from whatever the chat already knows about the
  // contact: linked client first, then the WhatsApp display name, then the
  // phone derived from the JID. The receptionist can still overwrite the
  // values — they're plain editable inputs.
  function resolvePrefill(conv: ConversationWithClient | null) {
    return {
      name: conv?.clients?.full_name ?? conv?.display_name ?? "",
      phone:
        conv?.clients?.phone ??
        (conv ? jidToPhone(conv.external_id, conv.wa_phone) ?? "" : ""),
    };
  }

  // ──── Form state ──────────────────────────────────────────────────────
  const initialPrefill = resolvePrefill(conversation);
  const [clientName, setClientName] = useState(initialPrefill.name);
  const [clientPhone, setClientPhone] = useState(initialPrefill.phone);
  const [items, setItems] = useState<DraftItem[]>([]);
  // Map: paymentMethodId → { checked, surchargeOverride? }
  // We snapshot the percent locally so the receptionist can bump
  // "Tarjeta 6 cuotas" from 30% → 0% for a one-off promo without
  // touching the global config.
  const [methodState, setMethodState] = useState<
    Record<string, { checked: boolean; surcharge: number }>
  >({});
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isSendingToChat, setIsSendingToChat] = useState(false);
  const sendingRef = useRef(false);

  // Reset on dialog open transitions only. Intentionally NOT on
  // `conversation`/`paymentMethods` changes: the parent re-creates those
  // references on every realtime tick (new message arrives → conversations
  // array gets refetched), which would otherwise wipe the draft mid-edit.
  useEffect(() => {
    if (!open) return;
    const pf = resolvePrefill(conversation);
    setClientName(pf.name);
    setClientPhone(pf.phone);
    setItems([]);
    setNotes("");
    // Default: tick the methods that are usually cash-equivalent so the
    // PDF never comes out empty. Owner can untick anything they don't want.
    const next: Record<string, { checked: boolean; surcharge: number }> = {};
    for (const m of paymentMethods) {
      next[m.id] = {
        checked: Number(m.surcharge_percent) === 0,
        surcharge: Number(m.surcharge_percent),
      };
    }
    setMethodState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ──── Derived ─────────────────────────────────────────────────────────
  const selectedServiceIds = useMemo(
    () =>
      new Set(items.map((i) => i.serviceId).filter(Boolean) as string[]),
    [items],
  );
  const totalMin = items.reduce((acc, i) => acc + (Number(i.priceMin) || 0), 0);
  const totalMax = items.reduce((acc, i) => acc + (Number(i.priceMax) || 0), 0);

  function toggleServiceFromCatalog(service: ServiceRow) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.serviceId === service.id);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, makeItemFromService(service)];
    });
  }

  function addCustomItem() {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        serviceId: null,
        serviceName: "",
        priceMin: 0,
        priceMax: 0,
      },
    ]);
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function toggleMethod(id: string, checked: boolean) {
    setMethodState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { surcharge: 0 }), checked },
    }));
  }

  function updateMethodSurcharge(id: string, value: number) {
    setMethodState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { checked: true }), surcharge: value },
    }));
  }

  // ──── Submit ──────────────────────────────────────────────────────────
  function validate(): { ok: true; payload: BudgetPdfPayload } | { ok: false; msg: string } {
    if (clientName.trim().length < 2)
      return { ok: false, msg: "El nombre de la clienta es muy corto." };
    if (items.length === 0)
      return { ok: false, msg: "Elegí al menos un servicio." };
    for (const it of items) {
      if (!it.serviceName.trim())
        return { ok: false, msg: "Todos los servicios necesitan un nombre." };
      if (it.priceMin < 0 || it.priceMax < 0)
        return { ok: false, msg: "Los precios no pueden ser negativos." };
      if (it.priceMax < it.priceMin)
        return {
          ok: false,
          msg: `En "${it.serviceName}" el precio máximo es menor al mínimo.`,
        };
    }
    const selectedMethods = paymentMethods.filter(
      (m) => methodState[m.id]?.checked,
    );
    if (selectedMethods.length === 0)
      return { ok: false, msg: "Elegí al menos un medio de pago." };

    return {
      ok: true,
      payload: {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || null,
        notes: notes.trim() || null,
        items: items.map((i) => ({
          name: i.serviceName.trim(),
          priceMin: i.priceMin,
          priceMax: i.priceMax,
        })),
        paymentOptions: selectedMethods.map((m) => ({
          label: m.label,
          surchargePercent:
            methodState[m.id]?.surcharge ?? Number(m.surcharge_percent),
          installments: m.installments,
        })),
        createdAt: new Date(),
      },
    };
  }

  async function persistBudget(payload: BudgetPdfPayload): Promise<
    | { ok: true; budgetId: string }
    | { ok: false; msg: string }
  > {
    const selectedMethods = paymentMethods.filter(
      (m) => methodState[m.id]?.checked,
    );
    const result = await createBudgetAction({
      conversationId: conversation?.id ?? null,
      clientId: conversation?.clients?.id ?? null,
      clientName: payload.clientName,
      clientPhone: payload.clientPhone,
      notes: payload.notes,
      items: items.map((i) => ({
        serviceId: i.serviceId,
        serviceName: i.serviceName.trim(),
        priceMin: i.priceMin,
        priceMax: i.priceMax,
      })),
      paymentOptions: selectedMethods.map((m) => ({
        paymentMethodId: m.id,
        label: m.label,
        surchargePercent:
          methodState[m.id]?.surcharge ?? Number(m.surcharge_percent),
        installments: m.installments,
      })),
    });

    if (result.error) return { ok: false, msg: result.error };
    if (result.fieldErrors) {
      const first = Object.values(result.fieldErrors)[0];
      return { ok: false, msg: first ?? "Datos inválidos." };
    }
    if (!result.budgetId) return { ok: false, msg: "Error inesperado." };
    return { ok: true, budgetId: result.budgetId };
  }

  function handleDownload() {
    const v = validate();
    if (!v.ok) {
      toast.error(v.msg);
      return;
    }
    startTransition(async () => {
      const saved = await persistBudget(v.payload);
      if (!saved.ok) {
        toast.error(saved.msg);
        return;
      }
      const blob = await buildBudgetPdf(v.payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = budgetPdfFilename(v.payload.clientName, v.payload.createdAt);
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Presupuesto guardado y descargado.");
      onOpenChange(false);
    });
  }

  function handleSendToChat() {
    if (!conversation) {
      toast.error("Sin conversación activa.");
      return;
    }
    if (sendingRef.current) return;
    const v = validate();
    if (!v.ok) {
      toast.error(v.msg);
      return;
    }
    sendingRef.current = true;
    setIsSendingToChat(true);
    (async () => {
      try {
        const saved = await persistBudget(v.payload);
        if (!saved.ok) {
          toast.error(saved.msg);
          return;
        }
        // Send as a PNG image (not a PDF document). Captioned PDFs go
        // out via Baileys as `documentWithCaptionMessage`, which several
        // WhatsApp clients render as "Esperando este mensaje…" because
        // they don't decode that newer protocol shape. Images don't
        // have that problem and also preview inline in the chat — the
        // client doesn't need to tap to open.
        const blob = await buildBudgetImage(v.payload);
        const filename = budgetImageFilename(
          v.payload.clientName,
          v.payload.createdAt,
        );
        const supabase = createClient();
        const path = `outbound/${conversation.id}/${crypto.randomUUID()}.png`;
        const { error: upErr } = await supabase.storage
          .from("wa-media")
          .upload(path, blob, {
            contentType: "image/png",
            upsert: false,
          });
        if (upErr) {
          toast.error(`No pudimos subir la imagen: ${upErr.message}`);
          return;
        }
        const result = await sendMediaMessageAction({
          conversationId: conversation.id,
          type: "image",
          mediaPath: path,
          mediaMime: "image/png",
          mediaFilename: filename,
        });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Presupuesto enviado al chat.");
        onOpenChange(false);
      } finally {
        sendingRef.current = false;
        setIsSendingToChat(false);
      }
    })();
  }

  // Sort the services so the ones already selected float to the top —
  // makes long catalogs scannable when editing.
  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) => {
      const aSel = selectedServiceIds.has(a.id) ? 0 : 1;
      const bSel = selectedServiceIds.has(b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.name.localeCompare(b.name);
    });
  }, [services, selectedServiceIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] sm:max-w-none sm:w-[min(1100px,96vw)] max-h-[94vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-0.5">
          <DialogTitle className="text-base">Nuevo presupuesto</DialogTitle>
          <DialogDescription className="text-xs">
            Elegí servicios y medios de pago. Generamos un PDF con el logo
            que podés descargar o mandar directo al chat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] gap-4">
          {/* ─── Left column: client + services + payment methods ─── */}
          <div className="space-y-4 min-w-0">
            {/* Client */}
            <div className="space-y-1.5">
              <Label className="text-xs">Clienta</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  className="h-8"
                  placeholder="Nombre"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
                <Input
                  className="h-8"
                  type="tel"
                  placeholder="Teléfono"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </div>
            </div>

            {/* Service catalog — quick toggle */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Servicios del catálogo</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={addCustomItem}
                >
                  <Plus className="size-3.5" />
                  Manual
                </Button>
              </div>
              {services.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border p-3">
                  No hay servicios cargados.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto rounded-md border bg-muted/10 p-1.5">
                  {sortedServices.map((s) => {
                    const checked = selectedServiceIds.has(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => toggleServiceFromCatalog(s)}
                        className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted/40 transition-colors ${
                          checked
                            ? "bg-foreground/5 border-foreground/40"
                            : "bg-card"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          tabIndex={-1}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {s.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            base {formatCurrency(s.price)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected items — editable price range */}
            <div className="space-y-1.5">
              <Label className="text-xs">Servicios elegidos</Label>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                  Elegí servicios del catálogo o agregá uno manual.
                </p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_32px] items-center gap-2 px-2.5 py-1.5 bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wide">
                    <span>Servicio</span>
                    <span className="text-right">Desde</span>
                    <span className="text-right">Hasta</span>
                    <span></span>
                  </div>
                  <div className="divide-y">
                    {items.map((it) => (
                      <div
                        key={it.key}
                        className="grid grid-cols-[minmax(0,1fr)_88px_88px_32px] items-center gap-2 px-2.5 py-1.5"
                      >
                        <Input
                          className="h-8 text-sm"
                          value={it.serviceName}
                          placeholder="Servicio"
                          onChange={(e) =>
                            updateItem(it.key, { serviceName: e.target.value })
                          }
                        />
                        <Input
                          className="h-8 text-sm text-right tabular-nums"
                          type="number"
                          min={0}
                          step={500}
                          value={it.priceMin}
                          onChange={(e) =>
                            updateItem(it.key, {
                              priceMin: e.target.valueAsNumber || 0,
                            })
                          }
                        />
                        <Input
                          className="h-8 text-sm text-right tabular-nums"
                          type="number"
                          min={0}
                          step={500}
                          value={it.priceMax}
                          onChange={(e) =>
                            updateItem(it.key, {
                              priceMax: e.target.valueAsNumber || 0,
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => removeItem(it.key)}
                          title="Quitar"
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/20 text-sm">
                    <span className="text-muted-foreground text-xs">
                      Subtotal
                    </span>
                    <span className="font-semibold tabular-nums">
                      {totalMin === totalMax
                        ? formatCurrency(totalMin)
                        : `${formatCurrency(totalMin)} — ${formatCurrency(totalMax)}`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment methods — multi pick with editable surcharges */}
            <div className="space-y-1.5">
              <Label className="text-xs">Medios de pago a ofrecer</Label>
              {paymentMethods.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border p-3">
                  No hay medios de pago cargados. Configurálos en
                  Configuración → Medios de pago.
                </p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <div className="grid grid-cols-[28px_minmax(0,1fr)_92px_minmax(0,140px)] items-center gap-2 px-2.5 py-1.5 bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wide">
                    <span></span>
                    <span>Medio</span>
                    <span className="text-right">Recargo %</span>
                    <span className="text-right">Total</span>
                  </div>
                  <div className="divide-y">
                    {paymentMethods.map((m) => {
                      const st = methodState[m.id] ?? {
                        checked: false,
                        surcharge: Number(m.surcharge_percent),
                      };
                      const sMin = applySurcharge(totalMin, st.surcharge);
                      const sMax = applySurcharge(totalMax, st.surcharge);
                      return (
                        <div
                          key={m.id}
                          className="grid grid-cols-[28px_minmax(0,1fr)_92px_minmax(0,140px)] items-center gap-2 px-2.5 py-1.5"
                        >
                          <Checkbox
                            checked={st.checked}
                            onCheckedChange={(v) =>
                              toggleMethod(m.id, v === true)
                            }
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {m.label}
                            </div>
                            {m.installments && m.installments > 1 ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 font-normal"
                              >
                                {m.installments} cuotas
                              </Badge>
                            ) : null}
                          </div>
                          <Input
                            className="h-8 text-sm text-right tabular-nums"
                            type="number"
                            step={0.5}
                            value={st.surcharge}
                            onChange={(e) =>
                              updateMethodSurcharge(
                                m.id,
                                e.target.valueAsNumber || 0,
                              )
                            }
                          />
                          <div className="text-right text-sm tabular-nums">
                            {totalMin > 0 || totalMax > 0 ? (
                              sMin === sMax ? (
                                formatCurrency(sMin)
                              ) : (
                                <span className="text-[12px]">
                                  {formatCurrency(sMin)} —{" "}
                                  {formatCurrency(sMax)}
                                </span>
                              )
                            ) : (
                              <span className="text-muted-foreground italic">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── Right column: notes + summary ─── */}
          <div className="space-y-3 min-w-0">
            <div className="rounded-md border bg-muted/20 px-3 py-2.5 space-y-1 text-xs">
              <div className="font-medium">Resumen</div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Servicios</span>
                <span className="font-medium tabular-nums">{items.length}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold tabular-nums">
                  {totalMin === totalMax
                    ? formatCurrency(totalMin)
                    : `${formatCurrency(totalMin)} — ${formatCurrency(totalMax)}`}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Medios elegidos</span>
                <span className="font-medium tabular-nums">
                  {
                    paymentMethods.filter((m) => methodState[m.id]?.checked)
                      .length
                  }
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="presupuesto-notes" className="text-xs">
                Notas para el PDF (opcional)
              </Label>
              <Textarea
                id="presupuesto-notes"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalles, condiciones, lo que quieras dejar por escrito..."
                className="text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={isPending || isSendingToChat}
          >
            {isPending && !isSendingToChat ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Descargar PDF
          </Button>
          {conversation ? (
            <Button
              type="button"
              size="sm"
              onClick={handleSendToChat}
              disabled={isPending || isSendingToChat}
            >
              {isSendingToChat ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar al chat
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
