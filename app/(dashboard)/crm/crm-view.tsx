"use client";

import { format, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  CornerDownRight,
  FileText,
  Hourglass,
  Lock,
  MessageCircle,
  MoreVertical,
  Search,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  markConversationReadAction,
  sendMessageAction,
} from "./actions";
import type {
  AppointmentWithRelations,
  ClientRow,
  ProfessionalRow,
  ServiceRow,
} from "../turnos/types";
import { ChatAvatar } from "./chat-avatar";
import { ChatTagsBar } from "./chat-tags-bar";
import type { ClientTag, PaymentMethod, QuickReply } from "./config-types";
import { MediaInput } from "./media-input";
import { MessageContent } from "./message-content";
import { NewTurnoDialog } from "./new-turno-dialog";
import { PresupuestoDialog } from "./presupuesto-dialog";
import { QuickReplyPicker } from "./quick-reply-picker";
import { ReactionPicker, ReactionsPill } from "./reaction-picker";
import type { ConversationWithClient, MessageRow } from "./types";

type StatusFilter = "all" | "unread" | "awaiting" | "answered";

function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid");
}

function digitsToPretty(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 8) return null;
  return `+${clean}`;
}

/**
 * Best-effort phone string for a conversation. For legacy `@s.whatsapp.net`
 * JIDs the digits are in the JID itself. For `@lid` JIDs we rely on
 * `wa_phone`, which the worker backfills from `msg.key.senderPn`.
 */
function conversationPhone(c: ConversationWithClient): string | null {
  if (isLidJid(c.external_id)) return digitsToPretty(c.wa_phone);
  const digits = c.external_id.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digitsToPretty(digits) ?? digitsToPretty(c.wa_phone);
}

function conversationTitle(c: ConversationWithClient): string {
  return (
    c.clients?.full_name ||
    c.display_name ||
    conversationPhone(c) ||
    "Contacto sin nombre"
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Ayer";
  return format(d, "d MMM", { locale: es });
}

function messageDayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Hoy";
  if (isYesterday(d)) return "Ayer";
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}

function StatusIcon({ status }: { status: MessageRow["status"] }) {
  if (status === "failed")
    return <CircleAlert className="size-3 text-rose-500" />;
  if (status === "queued" || status === "sending")
    return <Clock className="size-3 opacity-50" />;
  if (status === "read")
    return <CheckCheck className="size-3 text-sky-500" />;
  if (status === "delivered")
    return <CheckCheck className="size-3 opacity-60" />;
  return <Check className="size-3 opacity-60" />;
}

export function CrmView({
  initialConversations,
  initialSelectedId,
  quickReplies = [],
  allTags = [],
  bookingServices = [],
  professionals = [],
  clients = [],
  appointments = [],
  paymentMethods = [],
  onOpenConfig,
}: {
  initialConversations: ConversationWithClient[];
  initialSelectedId: string | null;
  quickReplies?: QuickReply[];
  allTags?: ClientTag[];
  bookingServices?: ServiceRow[];
  professionals?: ProfessionalRow[];
  clients?: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments?: AppointmentWithRelations[];
  paymentMethods?: PaymentMethod[];
  /** Abre la solapa de configuración desde el menú "⋮" de la bandeja. */
  onOpenConfig?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [newTurnoOpen, setNewTurnoOpen] = useState(false);
  const [presupuestoOpen, setPresupuestoOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to conversation changes (new conversations, last_message_at updates)
  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase
        .from("conversations")
        .select("*, clients ( id, full_name, phone, tags )")
        .eq("archived", false)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (!cancelled && data) setConversations(data as ConversationWithClient[]);
    }

    const channel = supabase
      .channel("crm-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void refetch(),
      )
      .subscribe();

    const pollId = setInterval(() => void refetch(), 5000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Load messages for selected conversation + subscribe to its inserts/updates
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    // Capture into a const so TS narrows it inside the inner closures —
    // outer narrowing doesn't propagate through async function boundaries.
    const sid: string = selectedId;
    let cancelled = false;

    async function refetch(initial = false) {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", sid)
        .order("sent_at", { ascending: true })
        .limit(500);
      if (cancelled || !data) return;
      const fetched = data as MessageRow[];
      if (initial) {
        setMessages(fetched);
        return;
      }
      // Only replace if something actually changed — avoids spurious
      // re-renders and scroll jumps when realtime already kept us in sync.
      setMessages((prev) => {
        if (prev.length !== fetched.length) return fetched;
        for (let i = 0; i < prev.length; i++) {
          if (
            prev[i].id !== fetched[i].id ||
            prev[i].status !== fetched[i].status ||
            prev[i].delivered_at !== fetched[i].delivered_at
          ) {
            return fetched;
          }
        }
        return prev;
      });
    }

    setLoadingMessages(true);
    void (async () => {
      await refetch(true);
      if (cancelled) return;
      setLoadingMessages(false);
      void markConversationReadAction(selectedId);
    })();

    const channel = supabase
      .channel(`crm-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const incoming = payload.new as MessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          void markConversationReadAction(selectedId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const updated = payload.new as MessageRow;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m)),
          );
        },
      )
      .subscribe();

    const pollId = setInterval(() => void refetch(false), 3000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [selectedId, supabase]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (statusFilter === "unread" && c.unread_count <= 0) return false;
      if (statusFilter === "awaiting" && !c.awaiting_reply) return false;
      if (statusFilter === "answered" && c.awaiting_reply) return false;
      if (tagFilter.length > 0) {
        const tags = c.clients?.tags ?? [];
        if (!tagFilter.some((t) => tags.includes(t))) return false;
      }
      if (needle) {
        // Buscamos por nombre y por teléfono: es como la gente encuentra a
        // una clienta cuando el contacto todavía no está vinculado.
        const haystack = [
          conversationTitle(c),
          conversationPhone(c) ?? "",
          c.last_message_preview ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [conversations, statusFilter, tagFilter, query]);

  const awaitingCount = useMemo(
    () => conversations.filter((c) => c.awaiting_reply).length,
    [conversations],
  );

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations],
  );

  const tagsByName = useMemo(() => {
    const map = new Map<string, ClientTag>();
    for (const t of allTags) map.set(t.name, t);
    return map;
  }, [allTags]);

  function toggleTagFilter(name: string) {
    setTagFilter((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  const filtersActive =
    statusFilter !== "all" || tagFilter.length > 0 || query.trim().length > 0;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const text = draft.trim();
    if (!text) return;

    startTransition(async () => {
      const result = await sendMessageAction(selected.id, text);
      if (result.error) {
        toast.error(result.error);
      } else {
        setDraft("");
      }
    });
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[400px_1fr]">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r border-border bg-card",
          selectedId && "hidden md:flex",
        )}
      >
        {/* Identidad de la cuenta conectada — el bloque superior del referente */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-wa-soft text-wa-ink">
            <MessageCircle className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[1.0625rem] font-semibold">WhatsApp</div>
            <div className="truncate text-[0.8125rem] text-muted-foreground tabular-nums">
              {filteredConversations.length}
              {filtersActive ? ` de ${conversations.length}` : ""}{" "}
              {conversations.length === 1 ? "conversación" : "conversaciones"}
            </div>
          </div>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setTagFilter([]);
                setQuery("");
              }}
              title="Limpiar filtros"
              aria-label="Limpiar filtros"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Check className="size-4" />
            </button>
          ) : null}
          {onOpenConfig ? (
            <button
              type="button"
              onClick={onOpenConfig}
              title="Configuración del CRM"
              aria-label="Configuración del CRM"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreVertical className="size-4" />
            </button>
          ) : null}
        </div>

        {/* Buscador */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscá un chat o un contacto"
              aria-label="Buscá un chat o un contacto"
              className="h-10 w-full rounded-full border border-transparent bg-muted pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:bg-card"
            />
          </div>
        </div>

        {/* Filtros rápidos */}
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            Todos
          </FilterChip>
          <FilterChip
            active={statusFilter === "unread"}
            onClick={() => setStatusFilter("unread")}
          >
            No leídos
            {unreadCount > 0 ? (
              <span className="tabular-nums">{unreadCount}</span>
            ) : null}
          </FilterChip>
          <FilterChip
            active={statusFilter === "awaiting"}
            onClick={() => setStatusFilter("awaiting")}
          >
            <Hourglass className="size-3" />
            Esperando
            {awaitingCount > 0 ? (
              <span className="tabular-nums">{awaitingCount}</span>
            ) : null}
          </FilterChip>
          <FilterChip
            active={statusFilter === "answered"}
            onClick={() => setStatusFilter("answered")}
          >
            Respondidos
          </FilterChip>
        </div>

        {allTags.some((t) => t.active) ? (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {allTags
              .filter((t) => t.active)
              .map((t) => {
                const checked = tagFilter.includes(t.name);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTagFilter(t.name)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
                      checked
                        ? "bg-foreground/5 font-medium"
                        : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    style={checked ? { borderColor: t.color } : undefined}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    {t.name}
                    {checked ? <Check className="size-3 opacity-60" /> : null}
                  </button>
                );
              })}
          </div>
        ) : null}
        <ScrollArea className="flex-1 min-h-0">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {conversations.length === 0
                ? "Cuando llegue un mensaje al WhatsApp del salón va a aparecer acá."
                : "Ninguna conversación coincide con el filtro."}
            </div>
          ) : (
            <ul>
              {filteredConversations.map((c) => {
                const isSel = c.id === selectedId;
                const title = conversationTitle(c);
                const phone = conversationPhone(c);
                const unread = c.unread_count > 0;
                // Surface the phone in the list when we have one AND the
                // title isn't already the phone itself. We show it especially
                // when the contact is not linked to a clienta — that's the
                // case where the user needs the number to identify them.
                const showPhoneInList =
                  phone && (c.clients?.full_name || c.display_name);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
                        isSel && "bg-muted",
                      )}
                    >
                      <ChatAvatar
                        name={title}
                        avatarPath={c.avatar_path}
                        size={48}
                      />
                      {/*
                        La separación entre filas va acá y no en el <li>: así
                        la línea arranca después del avatar, como en WhatsApp.
                      */}
                      <div className="min-w-0 flex-1 border-b border-border pb-2.5 [li:last-child_&]:border-b-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-[0.9375rem]",
                              unread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {title}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-[0.6875rem] tabular-nums",
                              unread
                                ? "font-semibold text-wa-ink"
                                : "text-muted-foreground",
                            )}
                          >
                            {relativeTime(c.last_message_at)}
                          </span>
                        </div>
                        {showPhoneInList && !c.clients ? (
                          <div className="truncate text-[0.6875rem] text-muted-foreground tabular-nums">
                            {phone}
                          </div>
                        ) : null}
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[0.8125rem] text-muted-foreground">
                            {c.last_message_preview ?? "Sin mensajes"}
                          </span>
                          {unread ? (
                            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa px-1.5 text-[0.6875rem] font-semibold tabular-nums text-white">
                              {c.unread_count > 99 ? "99+" : c.unread_count}
                            </span>
                          ) : null}
                        </div>
                        {(c.awaiting_reply ||
                          (c.clients?.tags?.length ?? 0) > 0) && (
                          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                            {c.awaiting_reply ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
                                <Hourglass className="size-2.5" />
                                Esperando
                              </span>
                            ) : null}
                            {(c.clients?.tags ?? [])
                              .slice(0, 3)
                              .map((name) => {
                                const meta = tagsByName.get(name);
                                return (
                                  <span
                                    key={name}
                                    className="inline-flex max-w-[90px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[0.6875rem]"
                                    style={{
                                      borderColor: meta?.color ?? "#94a3b8",
                                    }}
                                    title={name}
                                  >
                                    <span
                                      className="size-1.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor:
                                          meta?.color ?? "#94a3b8",
                                      }}
                                    />
                                    <span className="truncate">{name}</span>
                                  </span>
                                );
                              })}
                            {(c.clients?.tags?.length ?? 0) > 3 ? (
                              <span className="text-[0.6875rem] text-muted-foreground">
                                +{(c.clients?.tags?.length ?? 0) - 3}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* Thread */}
      <section
        className={cn(
          "relative flex flex-col overflow-hidden bg-background",
          !selectedId && "hidden md:flex",
        )}
      >
        {/* Cinta verde superior: la firma de la bandeja en el referente */}
        <span aria-hidden className="h-1 shrink-0 bg-wa" />

        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
            <EmptyInboxArt />
            <div className="space-y-2">
              <h2 className="text-[1.75rem] font-normal tracking-tight">
                Zenna en tu WhatsApp
              </h2>
              <p className="mx-auto max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
                Atendé a tus clientas, agendá turnos y mandá presupuestos sin
                salir del chat. Elegí una conversación de la izquierda para
                empezar.
              </p>
            </div>
            <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <Lock className="size-3.5" />
              Tus conversaciones quedan guardadas y protegidas en tu cuenta
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <ChatAvatar
                name={conversationTitle(selected)}
                avatarPath={selected.avatar_path}
                size={36}
              />
              <div className="flex flex-col min-w-0 leading-tight flex-1">
                <span className="font-medium truncate">
                  {conversationTitle(selected)}
                </span>
                {(() => {
                  const phone = conversationPhone(selected);
                  // Don't repeat the phone underneath the title when the
                  // title itself already IS the phone (no name available).
                  const titleIsPhone =
                    !selected.clients?.full_name && !selected.display_name;
                  if (phone && !titleIsPhone) {
                    return (
                      <span className="text-xs text-muted-foreground truncate tabular-nums">
                        {phone}
                        {!selected.clients ? (
                          <span className="not-tabular-nums">
                            {" "}
                            · sin clienta asociada
                          </span>
                        ) : null}
                      </span>
                    );
                  }
                  if (!selected.clients) {
                    return (
                      <span className="text-xs text-muted-foreground truncate">
                        {phone
                          ? "Sin clienta asociada"
                          : "Sin número visible · sin clienta"}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setNewTurnoOpen(true)}
              >
                <CalendarPlus className="size-4" />
                <span className="hidden sm:inline">Nuevo turno</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setPresupuestoOpen(true)}
              >
                <FileText className="size-4" />
                <span className="hidden sm:inline">Presupuestar</span>
              </Button>
            </div>

            <ChatTagsBar
              conversationId={selected.id}
              contactName={conversationTitle(selected)}
              currentTags={selected.clients?.tags ?? []}
              allTags={allTags}
              onChange={(next, linkedClient) => {
                // Patch local list: ensure the conversation now reflects the
                // (possibly newly-created) clienta + the latest tags.
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === selected.id
                      ? {
                          ...c,
                          clients: {
                            id: linkedClient.id,
                            full_name: linkedClient.full_name,
                            phone: linkedClient.phone,
                            tags: next,
                          },
                        }
                      : c,
                  ),
                );
              }}
            />

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-1 bg-muted/10"
            >
              {loadingMessages ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className={cn(
                        "h-10",
                        i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto",
                      )}
                    />
                  ))}
                </div>
              ) : (
                <MessagesRender
                  messages={messages}
                  conversationId={selected.id}
                />
              )}
            </div>

            <form
              onSubmit={handleSend}
              className="border-t p-2 sm:p-3 flex items-center gap-1.5 sm:gap-2 bg-card"
            >
              <MediaInput
                conversationId={selected.id}
                disabled={isPending}
              />
              <QuickReplyPicker
                replies={quickReplies}
                onSelect={(body) =>
                  setDraft((d) => (d.trim() ? `${d} ${body}` : body))
                }
                disabled={isPending}
              />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribí un mensaje…"
                autoComplete="off"
                disabled={isPending}
                className="flex-1 min-w-0"
              />
              <Button
                type="submit"
                disabled={isPending || draft.trim().length === 0}
                size="icon"
                className="shrink-0"
              >
                <Send className="size-4" />
                <span className="sr-only">Enviar</span>
              </Button>
            </form>
          </>
        )}
      </section>

      <NewTurnoDialog
        open={newTurnoOpen}
        onOpenChange={setNewTurnoOpen}
        conversation={selected}
        professionals={professionals}
        services={bookingServices}
        clients={clients}
        appointments={appointments}
      />

      <PresupuestoDialog
        open={presupuestoOpen}
        onOpenChange={setPresupuestoOpen}
        conversation={selected}
        services={bookingServices}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}

function MessagesRender({
  messages,
  conversationId,
}: {
  messages: MessageRow[];
  conversationId: string;
}) {
  // Index by external_id so we can resolve "this message replies to X"
  const byExternalId = new Map<string, MessageRow>();
  for (const m of messages) {
    if (m.external_id) byExternalId.set(m.external_id, m);
  }

  // Aggregate reactions per target. Last reaction wins per author so that an
  // emoji change replaces the previous one and an empty body removes it.
  //   key = target_external_id
  //   value = Record<emoji, count>
  // For inbound reactions: one per author (the contact), so each unique non-
  // empty emoji counts as 1. We keep only the latest per direction to mirror
  // WhatsApp's "one reaction per user" rule.
  const reactionsByTarget = new Map<string, Record<string, number>>();
  // Latest emoji per (target, direction)
  const latestByPair = new Map<string, string>();
  for (const m of messages) {
    if (m.type !== "reaction" || !m.reaction_target_external_id) continue;
    const key = `${m.reaction_target_external_id}|${m.direction}`;
    latestByPair.set(key, (m.body ?? "").trim());
  }
  for (const [key, emoji] of latestByPair) {
    if (!emoji) continue;
    const targetId = key.split("|")[0]!;
    const bucket = reactionsByTarget.get(targetId) ?? {};
    bucket[emoji] = (bucket[emoji] ?? 0) + 1;
    reactionsByTarget.set(targetId, bucket);
  }

  // Filter reaction messages out of the rendered stream
  const visible = messages.filter((m) => m.type !== "reaction");

  if (visible.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Sin mensajes todavía. Mandá el primero ↓
      </div>
    );
  }

  // Group by day for separators
  const items: Array<
    { kind: "day"; label: string; key: string } | { kind: "msg"; m: MessageRow }
  > = [];
  let lastDay = "";
  for (const m of visible) {
    const day = messageDayLabel(m.sent_at);
    if (day !== lastDay) {
      items.push({ kind: "day", label: day, key: `day-${m.id}` });
      lastDay = day;
    }
    items.push({ kind: "msg", m });
  }

  return (
    <>
      {items.map((it) =>
        it.kind === "day" ? (
          <div key={it.key} className="flex justify-center my-3">
            <span className="text-[10px] uppercase tracking-wider rounded-full bg-card px-2.5 py-1 text-muted-foreground border">
              {it.label}
            </span>
          </div>
        ) : (
          <Bubble
            key={it.m.id}
            message={it.m}
            conversationId={conversationId}
            replyTo={
              it.m.reply_to_external_id
                ? (byExternalId.get(it.m.reply_to_external_id) ?? null)
                : null
            }
            reactions={
              it.m.external_id
                ? (reactionsByTarget.get(it.m.external_id) ?? null)
                : null
            }
          />
        ),
      )}
    </>
  );
}

function ReplyPreview({
  message,
  isOutbound,
}: {
  message: MessageRow;
  isOutbound: boolean;
}) {
  const preview =
    message.body ??
    (message.type === "image"
      ? "📷 Imagen"
      : message.type === "video"
        ? "🎥 Video"
        : message.type === "audio"
          ? "🎤 Audio"
          : message.type === "document"
            ? "📄 Documento"
            : message.type === "sticker"
              ? "🩷 Sticker"
              : "Mensaje");
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md px-2 py-1 mb-1 text-xs border-l-2 -mx-1",
        isOutbound
          ? "bg-background/15 border-background/40 text-background/85"
          : "bg-muted/60 border-muted-foreground/30 text-muted-foreground",
      )}
    >
      <CornerDownRight className="size-3 mt-0.5 shrink-0 opacity-70" />
      <span className="truncate">{preview}</span>
    </div>
  );
}

function Bubble({
  message,
  conversationId,
  replyTo,
  reactions,
}: {
  message: MessageRow;
  conversationId: string;
  replyTo: MessageRow | null;
  reactions: Record<string, number> | null;
}) {
  const isOutbound = message.direction === "outbound";
  const isMedia = message.type !== "text" && !!message.media_url;
  // We can only react to messages that have been confirmed by WhatsApp
  // (i.e. they have an external_id we can reference in the reaction key).
  const canReact = !!message.external_id;

  return (
    <div
      className={cn(
        "group flex items-end gap-1.5",
        isOutbound ? "justify-end" : "justify-start",
      )}
    >
      {/* Picker on the outbound side — left of bubble */}
      {isOutbound && canReact ? (
        <ReactionPicker
          conversationId={conversationId}
          targetExternalId={message.external_id!}
          alignRight
        />
      ) : null}

      <div
        className={cn(
          "relative max-w-[78%] rounded-2xl px-3 py-1.5 shadow-xs",
          isOutbound
            ? "bg-foreground text-background rounded-br-sm"
            : "bg-card border rounded-bl-sm",
          message.status === "failed" &&
            "border-rose-300 bg-rose-50 text-foreground",
          isMedia && "px-2 pt-2 pb-1.5",
        )}
      >
        {replyTo ? (
          <ReplyPreview message={replyTo} isOutbound={isOutbound} />
        ) : null}
        <MessageContent message={message} isOutbound={isOutbound} />
        <div
          className={cn(
            "flex items-center justify-end gap-1 mt-0.5",
            isOutbound ? "text-background/70" : "text-muted-foreground",
          )}
        >
          <span className="text-[10px] tabular-nums">
            {format(new Date(message.sent_at), "HH:mm")}
          </span>
          {isOutbound ? <StatusIcon status={message.status} /> : null}
        </div>
        {message.status === "failed" && message.error ? (
          <div
            className="text-[10px] text-rose-700 mt-0.5"
            title={message.error}
          >
            Error · {message.error.slice(0, 60)}
          </div>
        ) : null}

        {reactions ? (
          <ReactionsPill
            counts={reactions}
            className={cn(
              "absolute -bottom-2.5",
              isOutbound ? "right-2" : "left-2",
            )}
          />
        ) : null}
      </div>

      {!isOutbound && canReact ? (
        <ReactionPicker
          conversationId={conversationId}
          targetExternalId={message.external_id!}
        />
      ) : null}
    </div>
  );
}

/**
 * Chip de filtro de la bandeja. Activo = verde WhatsApp suave; inactivo =
 * gris cálido. Sin bordes: el color de fondo es todo el estado.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors",
        active
          ? "bg-wa-soft text-wa-ink"
          : "bg-muted text-secondary-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Ilustración del estado vacío: un monitor y un teléfono de trazo fino, en
 * gris muy claro. Es puramente decorativa — de ahí el aria-hidden.
 */
function EmptyInboxArt() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 150"
      className="h-[150px] w-[240px] text-border"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Monitor */}
      <rect x="6" y="10" width="160" height="106" rx="10" />
      <line x1="70" y1="128" x2="102" y2="128" />
      <line x1="86" y1="116" x2="86" y2="128" />
      {/* Líneas de contenido */}
      <rect
        x="30"
        y="36"
        width="86"
        height="12"
        rx="6"
        fill="currentColor"
        stroke="none"
        opacity="0.55"
      />
      <rect
        x="30"
        y="60"
        width="58"
        height="12"
        rx="6"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      {/* Teléfono */}
      <rect
        x="164"
        y="40"
        width="70"
        height="104"
        rx="12"
        fill="var(--card)"
      />
      <rect
        x="186"
        y="68"
        width="42"
        height="10"
        rx="5"
        fill="currentColor"
        stroke="none"
        opacity="0.45"
      />
      <circle cx="199" cy="130" r="5" fill="currentColor" stroke="none" opacity="0.45" />
    </svg>
  );
}
