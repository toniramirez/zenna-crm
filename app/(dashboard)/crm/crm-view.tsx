"use client";

import { format, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  Ban,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock,
  CornerDownRight,
  FileText,
  Forward,
  Hourglass,
  Lock,
  MessageCircle,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import { MobileChromeAccount } from "@/components/dashboard/mobile-chrome";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { onOpenConversation } from "@/lib/push/open-conversation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  editMessageAction,
  markConversationReadAction,
  sendMessageAction,
  togglePinConversationAction,
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
import { ForwardDialog } from "./forward-dialog";
import { MediaInput } from "./media-input";
import { MessageActions } from "./message-actions";
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
 *
 * En Instagram no hay teléfono: el `external_id` es el IGSID, que es numérico
 * y se leería como un número larguísimo si lo dejáramos pasar por acá. Salvo
 * que alguien haya cargado el teléfono en la ficha de la clienta, no hay dato.
 */
function conversationPhone(c: ConversationWithClient): string | null {
  if (c.channel === "instagram") return digitsToPretty(c.clients?.phone);
  if (isLidJid(c.external_id)) return digitsToPretty(c.wa_phone);
  const digits = c.external_id.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digitsToPretty(digits) ?? digitsToPretty(c.wa_phone);
}

function conversationTitle(c: ConversationWithClient): string {
  return (
    c.clients?.full_name ||
    c.display_name ||
    conversationPhone(c) ||
    (c.channel === "instagram" ? "Contacto de Instagram" : "Contacto sin nombre")
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Ayer";
  return format(d, "d MMM", { locale: es });
}

/**
 * Cuánto hace que una conversación espera respuesta. `last_message_at` sirve
 * de reloj porque, mientras `awaiting_reply` siga en true, el último mensaje
 * es el de la clienta: en cuanto el salón contesta el flag se apaga.
 */
type WaitLevel = "fresh" | "warm" | "cold";

const WAIT_WARM_MS = 4 * 60 * 60 * 1000;
const WAIT_COLD_MS = 24 * 60 * 60 * 1000;

function waitElapsed(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return `hace ${Math.floor(days / 7)} sem`;
}

/**
 * `now` llega en null durante el render del servidor y el primer render del
 * cliente: sin reloj mostramos la versión neutra, así el HTML coincide y no
 * hay mismatch de hidratación.
 */
function waitState(
  c: ConversationWithClient,
  now: number | null,
): { level: WaitLevel; label: string } {
  if (!now || !c.last_message_at) return { level: "fresh", label: "Esperando" };
  const ms = now - new Date(c.last_message_at).getTime();
  if (ms < WAIT_WARM_MS) return { level: "fresh", label: "Esperando" };
  return {
    level: ms < WAIT_COLD_MS ? "warm" : "cold",
    label: `Esperando ${waitElapsed(ms)}`,
  };
}

/*
 * Reloj de la bandeja, a un tick por minuto. Va como store externo y no como
 * useState + efecto por dos razones: el snapshot del servidor es `null`, así
 * que el HTML no depende de la hora y la hidratación nunca choca; y un solo
 * intervalo alcanza para todas las filas de la lista.
 */
const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  clockTimer ??= setInterval(() => {
    clockNow = Date.now();
    for (const listener of clockListeners) listener();
  }, 60_000);

  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function useMinuteClock(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow,
    () => null,
  );
}

function messageDayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Hoy";
  if (isYesterday(d)) return "Ayer";
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}

/**
 * Tildes de estado. El azul del "leído" y el gris de los demás salen de los
 * tokens de la bandeja (`--wa-tick-read` / `--wa-tick`), no del tema de la app.
 */
function StatusIcon({ status }: { status: MessageRow["status"] }) {
  if (status === "failed")
    return <CircleAlert className="size-3 text-destructive" />;
  if (status === "queued" || status === "sending")
    return <Clock className="size-3 text-[var(--wa-tick)] opacity-70" />;
  if (status === "read")
    return <CheckCheck className="size-3 text-[var(--wa-tick-read)]" />;
  if (status === "delivered")
    return <CheckCheck className="size-3 text-[var(--wa-tick)]" />;
  return <Check className="size-3 text-[var(--wa-tick)]" />;
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
  /** Mensaje que se está editando; el campo de escritura pasa a modo edición. */
  const [editing, setEditing] = useState<MessageRow | null>(null);
  /** Mensaje elegido para reenviar; abre el selector de chats. */
  const [forwarding, setForwarding] = useState<MessageRow | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  // Hace envejecer sola la etiqueta "Esperando hace 5 h", sin depender de que
  // llegue un mensaje nuevo que provoque el re-render.
  const now = useMinuteClock();

  // Subscribe to conversation changes (new conversations, last_message_at updates)
  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase
        .from("conversations")
        .select("*, clients ( id, full_name, phone, tags )")
        .eq("archived", false)
        .order("pinned_at", { ascending: false, nullsFirst: false })
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

  // Toque en una notificación con la bandeja ya abierta. El id llega por el
  // puente del service worker y no por la URL: `selectedId` es estado de React
  // y una navegación a /crm?c=… no lo reemplaza una vez montado.
  useEffect(() => onOpenConversation(setSelectedId), []);

  // Al abrir una conversación el cursor ya queda en el campo de escritura.
  // Solo en desktop: en el celular esto levantaría el teclado y taparía el chat.
  useEffect(() => {
    if (!selectedId) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    composerRef.current?.focus();
  }, [selectedId]);

  // Cambiar de chat cancela una edición a medias: ese texto pertenecía al
  // mensaje de otra conversación y mandarlo acá sería un accidente. Se ajusta
  // durante el render y no en un efecto para que la cinta de "Editando" no
  // llegue a dibujarse sobre el chat nuevo.
  const [lastSelectedId, setLastSelectedId] = useState(selectedId);
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (editing) {
      setEditing(null);
      setDraft("");
    }
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Al entrar en modo edición el cursor va al campo, con el texto viejo ya
  // cargado. Va en un efecto y no en el handler del menú: mientras el menú
  // sigue montado su trampa de foco lo devuelve a la fuerza.
  useEffect(() => {
    if (editing) composerRef.current?.focus();
  }, [editing]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = conversations.filter((c) => {
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

    // Los fijados van arriba de todo, entre ellos por cuándo se fijaron. El
    // orden se rehace acá y no sólo en la consulta porque la lista también se
    // actualiza en caliente (realtime y el parche optimista del "fijar").
    return [...matching].sort((a, b) => {
      const pinA = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
      const pinB = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
      if (pinA !== pinB) return pinB - pinA;
      const lastA = a.last_message_at
        ? new Date(a.last_message_at).getTime()
        : 0;
      const lastB = b.last_message_at
        ? new Date(b.last_message_at).getTime()
        : 0;
      return lastB - lastA;
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

  /** Mensajes sin leer, no conversaciones: es el número que se busca de reojo. */
  const unreadMessages = useMemo(
    () => conversations.reduce((sum, c) => sum + Math.max(0, c.unread_count), 0),
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

  /**
   * Fijar / desfijar. El parche local va primero: la fila salta arriba en el
   * acto y el refetch de la suscripción confirma después. Si el servidor
   * rechaza, se vuelve a como estaba.
   */
  function togglePin(conversation: ConversationWithClient) {
    const previous = conversation.pinned_at;
    const next = previous ? null : new Date().toISOString();
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversation.id ? { ...c, pinned_at: next } : c,
      ),
    );

    void (async () => {
      const result = await togglePinConversationAction(
        conversation.id,
        next !== null,
      );
      if (result.error) {
        toast.error(result.error);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversation.id ? { ...c, pinned_at: previous } : c,
          ),
        );
      }
    })();
  }

  function startEdit(message: MessageRow) {
    setEditing(message);
    setDraft(message.body ?? "");
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
    composerRef.current?.focus();
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const text = draft.trim();
    if (!text) return;

    // Modo edición: el campo no manda un mensaje nuevo, reescribe el que está
    // enganchado arriba. Igual que en WhatsApp, el Enter confirma la edición.
    if (editing) {
      const target = editing;
      setDraft("");
      setEditing(null);
      composerRef.current?.focus();
      startTransition(async () => {
        const result = await editMessageAction(target.id, text);
        if (result.error) {
          toast.error(result.error);
          // Devolvemos el texto y el modo edición: el mensaje sigue como estaba.
          setEditing(target);
          setDraft(text);
        }
      });
      return;
    }

    // Vaciamos el campo y devolvemos el foco en el acto: en un chat se escribe
    // en ráfagas y esperar la respuesta del servidor para poder seguir tipeando
    // obliga a volver a clickear después de cada Enter.
    setDraft("");
    composerRef.current?.focus();

    startTransition(async () => {
      const result = await sendMessageAction(selected.id, text);
      if (result.error) {
        toast.error(result.error);
        // Devolvemos el texto solo si no empezó a escribir otra cosa.
        setDraft((d) => (d.trim() ? d : text));
      }
    });
  }

  return (
    <div className="wa-scope grid h-full min-h-0 grid-cols-1 bg-[var(--wa-app)] text-[var(--wa-text)] md:grid-cols-[400px_1fr]">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r border-[var(--wa-border)] bg-[var(--wa-panel)]",
          selectedId && "hidden md:flex",
        )}
      >
        {/*
          Encabezado del teléfono: es la pantalla "Chats" de WhatsApp. Título
          grande, acciones al ras de los bordes y nada más — la navegación ya
          está abajo en la barra de pestañas.

          `data-mobile-header` hace que el chrome esconda su propia barra de
          marca; sin eso se apilaban las dos y quedaban ~116px de cromo antes
          del primer chat. La cuenta se trae acá adentro con
          `MobileChromeAccount`.
        */}
        <div
          data-mobile-header
          className="shrink-0 bg-[var(--wa-panel)] px-4 pt-1 md:hidden"
        >
          <div className="flex h-11 items-center">
            {onOpenConfig ? (
              <button
                type="button"
                onClick={onOpenConfig}
                aria-label="Configuración del CRM"
                className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text)] active:bg-[var(--wa-hover)]"
              >
                <MoreHorizontal className="size-5" strokeWidth={2} />
              </button>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {filtersActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setTagFilter([]);
                    setQuery("");
                  }}
                  aria-label="Limpiar filtros"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text)] active:bg-[var(--wa-hover)]"
                >
                  <Check className="size-5" strokeWidth={2} />
                </button>
              ) : null}
              <MobileChromeAccount />
            </div>
          </div>
          <h1 className="pb-2 pt-1 font-display text-[2rem] font-bold leading-none tracking-tight text-[var(--wa-text)]">
            Chats
          </h1>
        </div>

        {/*
          Encabezado del escritorio: la identidad de la cuenta conectada, tal
          cual el referente. Acá el título grande no va — la bandeja comparte
          la pantalla con el hilo y con el rail.
        */}
        <div className="hidden h-[var(--wa-header-h)] shrink-0 items-center gap-3 bg-[var(--wa-panel-header)] px-4 md:flex">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--wa-avatar-bg)] text-[var(--wa-icon)]">
            <MessageCircle className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[1.0625rem] font-medium text-[var(--wa-text)]">
              WhatsApp
            </div>
            <div className="truncate text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
              {filteredConversations.length}
              {filtersActive ? ` de ${conversations.length}` : ""}{" "}
              {conversations.length === 1 ? "conversación" : "conversaciones"}
              {unreadMessages > 0 ? (
                <span className="font-medium text-[var(--wa-accent-strong)]">
                  {" · "}
                  {unreadMessages} sin leer
                </span>
              ) : null}
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
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
            >
              <Check className="size-5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onOpenConfig ? (
            <button
              type="button"
              onClick={onOpenConfig}
              title="Configuración del CRM"
              aria-label="Configuración del CRM"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
            >
              <MoreVertical className="size-5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>

        {/* Buscador. En el teléfono es la píldora ancha de WhatsApp. */}
        <div className="shrink-0 px-4 pb-2 md:px-3 md:py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-[var(--wa-text-3)] md:left-3.5 md:size-4" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscá un chat o un contacto"
              aria-label="Buscá un chat o un contacto"
              className="h-11 w-full rounded-full border border-transparent bg-[var(--wa-search-bg)] pl-12 pr-4 text-[0.9375rem] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] focus:border-[var(--wa-divider)] focus:bg-[var(--wa-search-field)] md:h-9 md:rounded-lg md:pl-11 md:text-[0.8125rem]"
            />
          </div>
        </div>

        {/*
          Filtros rápidos. En el teléfono ruedan en una sola fila horizontal
          —como los chips de WhatsApp— en vez de envolverse y empujar la lista
          hacia abajo; en escritorio sí envuelven, que ahí sobra alto.
        */}
        <div className="hide-scrollbar flex shrink-0 flex-nowrap gap-2 overflow-x-auto px-4 pb-2 md:flex-wrap md:overflow-visible md:px-3">
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
          <div className="hide-scrollbar flex shrink-0 flex-nowrap gap-1.5 overflow-x-auto px-4 pb-2 md:flex-wrap md:overflow-visible md:px-3">
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
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
                      checked
                        ? "bg-[var(--wa-active)] font-medium text-[var(--wa-text)]"
                        : "border-transparent bg-[var(--wa-search-bg)] text-[var(--wa-text-2)] hover:text-[var(--wa-text)]",
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
        {/*
          `--tabbar-space` es el hueco de la barra de pestañas del teléfono
          (0 en escritorio): sin él la última conversación queda tapada por la
          barra y no hay forma de llegar a ella.
        */}
        <ScrollArea className="flex-1 min-h-0">
          {filteredConversations.length === 0 ? (
            <div className="p-6 pb-[calc(1.5rem+var(--tabbar-space))] text-center text-sm text-[var(--wa-text-2)]">
              {conversations.length === 0
                ? "Cuando llegue un mensaje al WhatsApp del salón va a aparecer acá."
                : "Ninguna conversación coincide con el filtro."}
            </div>
          ) : (
            <ul className="pb-[var(--tabbar-space)]">
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
                const wait = c.awaiting_reply ? waitState(c, now) : null;
                const pinned = !!c.pinned_at;
                return (
                  <li key={c.id} className="group/row relative">
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                        isSel
                          ? "wa-row-active"
                          : "hover:bg-[var(--wa-hover)]",
                      )}
                    >
                      {/*
                        Una espera de más de un día se marca con un filete al
                        borde: se ve de reojo bajando la lista sin ensuciar la
                        fila para las conversaciones al día.
                      */}
                      {wait?.level === "cold" ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-[3px] bg-[var(--wa-wait-cold)]"
                        />
                      ) : null}
                      <ChatAvatar
                        name={title}
                        avatarPath={c.avatar_path}
                        channel={c.channel}
                        size={48}
                      />
                      {/*
                        La separación entre filas va acá y no en el <li>: así
                        la línea arranca después del avatar, como en WhatsApp.
                      */}
                      {/*
                        En el teléfono el botón del menú vive siempre visible
                        sobre el borde derecho, así que la fila le reserva su
                        lugar. En escritorio aparece con el hover y no hace
                        falta el hueco.
                      */}
                      <div className="min-w-0 flex-1 border-b border-[var(--wa-divider)] pb-2.5 pr-7 md:pr-0 [li:last-child_&]:border-b-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-[0.9375rem] text-[var(--wa-text)]",
                              unread ? "font-semibold" : "font-normal",
                            )}
                          >
                            {title}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-[0.6875rem] tabular-nums",
                              unread
                                ? "font-medium text-[var(--wa-accent-strong)]"
                                : "text-[var(--wa-text-2)]",
                            )}
                          >
                            {relativeTime(c.last_message_at)}
                          </span>
                        </div>
                        {showPhoneInList && !c.clients ? (
                          <div className="truncate text-[0.6875rem] text-[var(--wa-text-3)] tabular-nums">
                            {phone}
                          </div>
                        ) : null}
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[0.8125rem] text-[var(--wa-text-2)]">
                            {c.last_message_preview ?? "Sin mensajes"}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {pinned ? (
                              <Pin
                                role="img"
                                aria-label="Chat fijado"
                                className="size-3.5 -rotate-45 text-[var(--wa-text-3)]"
                              />
                            ) : null}
                            {unread ? (
                              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wa-badge)] px-1.5 text-[0.6875rem] font-medium tabular-nums text-[var(--wa-badge-text)]">
                                {c.unread_count > 99 ? "99+" : c.unread_count}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {(c.awaiting_reply ||
                          (c.clients?.tags?.length ?? 0) > 0) && (
                          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                            {wait ? (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                                  wait.level === "cold"
                                    ? "bg-[var(--wa-wait-cold-bg)] text-[var(--wa-wait-cold)]"
                                    : wait.level === "warm"
                                      ? "bg-[var(--wa-wait-warm-bg)] text-[var(--wa-wait-warm)]"
                                      : "bg-[var(--wa-system-bubble)] text-[var(--wa-system-text)]",
                                )}
                              >
                                <Hourglass className="size-2.5" />
                                {wait.label}
                              </span>
                            ) : null}
                            {(c.clients?.tags ?? [])
                              .slice(0, 3)
                              .map((name) => {
                                const meta = tagsByName.get(name);
                                return (
                                  <span
                                    key={name}
                                    className="inline-flex max-w-[90px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[0.6875rem] text-[var(--wa-text-2)]"
                                    style={{
                                      borderColor: meta?.color ?? "#a19d9c",
                                    }}
                                    title={name}
                                  >
                                    <span
                                      className="size-1.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor:
                                          meta?.color ?? "#a19d9c",
                                      }}
                                    />
                                    <span className="truncate">{name}</span>
                                  </span>
                                );
                              })}
                            {(c.clients?.tags?.length ?? 0) > 3 ? (
                              <span className="text-[0.6875rem] text-[var(--wa-text-3)]">
                                +{(c.clients?.tags?.length ?? 0) - 3}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </button>

                    {/*
                      Menú de la fila, el del chevron de WhatsApp Web. Va como
                      hermano del <button> y no adentro: un botón dentro de
                      otro no es HTML válido y el click se pelearía entre los
                      dos. Se apoya sobre el borde derecho, donde no tapa el
                      nombre ni la vista previa.
                    */}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-70 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100 md:opacity-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Opciones de ${title}`}
                            className="flex size-6 items-center justify-center rounded-full bg-[var(--wa-panel)]/80 text-[var(--wa-icon)] backdrop-blur-sm hover:bg-[var(--wa-hover)]"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onSelect={() => togglePin(c)}>
                            {pinned ? (
                              <>
                                <PinOff className="size-4" />
                                Desfijar chat
                              </>
                            ) : (
                              <>
                                <Pin className="size-4" />
                                Fijar chat
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/*
        Thread. Con una conversación abierta esto es, en el teléfono, toda la
        pantalla: `data-mobile-fullscreen` le avisa al chrome que retire la
        barra de pestañas y ponga `--tabbar-space` en cero. En WhatsApp pasa lo
        mismo — mientras chateás no hay barra abajo, hay teclado.

        El atributo va sólo cuando hay conversación elegida: la sección existe
        siempre en el DOM (escondida con `hidden md:flex`), así que ponerlo
        fijo escondería la barra también en la lista.
      */}
      <section
        data-mobile-fullscreen={selectedId ? "" : undefined}
        className={cn(
          "relative flex flex-col overflow-hidden bg-[var(--wa-panel-header)]",
          !selectedId && "hidden md:flex",
        )}
      >
        {/*
          Cinta verde superior: la firma de la bandeja en el referente. Es de
          escritorio nomás — en el teléfono el hilo va a sangre y una línea
          verde arriba de todo no existe en WhatsApp.
        */}
        <span
          aria-hidden
          className="hidden h-1 shrink-0 bg-[var(--wa-accent)] md:block"
        />

        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
            <EmptyInboxArt />
            <div className="space-y-2">
              <h2 className="font-display text-[1.75rem] font-normal tracking-tight text-[var(--wa-text)]">
                Zenna en tu WhatsApp
              </h2>
              <p className="mx-auto max-w-md text-[0.9375rem] leading-relaxed text-[var(--wa-text-2)]">
                Atendé a tus clientas, agendá turnos y mandá presupuestos sin
                salir del chat. Elegí una conversación de la izquierda para
                empezar.
              </p>
            </div>
            <p className="flex items-center gap-2 text-[0.8125rem] text-[var(--wa-text-3)]">
              <Lock className="size-3.5" />
              Tus conversaciones quedan guardadas y protegidas en tu cuenta
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-[var(--wa-header-h)] shrink-0 items-center gap-3 border-b border-[var(--wa-divider)] bg-[var(--wa-panel-header)] px-4">
              <button
                type="button"
                aria-label="Volver a la lista"
                className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)] md:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft className="size-5" strokeWidth={1.75} />
              </button>
              <ChatAvatar
                name={conversationTitle(selected)}
                avatarPath={selected.avatar_path}
                channel={selected.channel}
                size={40}
              />
              <div className="flex flex-col min-w-0 leading-tight flex-1">
                <span className="truncate text-[1rem] text-[var(--wa-text)]">
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
                      <span className="text-[0.8125rem] text-[var(--wa-text-2)] truncate tabular-nums">
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
                      <span className="text-[0.8125rem] text-[var(--wa-text-2)] truncate">
                        {phone
                          ? "Sin clienta asociada"
                          : "Sin número visible · sin clienta"}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              {/*
                Acciones del encabezado: en WhatsApp son íconos pelados sobre
                la barra gris, sin caja. El texto aparece recién en desktop.
              */}
              <button
                type="button"
                title="Nuevo turno"
                className="flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
                onClick={() => setNewTurnoOpen(true)}
              >
                <CalendarPlus className="size-5" strokeWidth={1.75} />
                <span className="hidden text-[0.8125rem] lg:inline">
                  Nuevo turno
                </span>
              </button>
              <button
                type="button"
                title="Presupuestar"
                className="flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
                onClick={() => setPresupuestoOpen(true)}
              >
                <FileText className="size-5" strokeWidth={1.75} />
                <span className="hidden text-[0.8125rem] lg:inline">
                  Presupuestar
                </span>
              </button>
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

            {/*
              El papel de la conversación no scrollea: el muro de garabatos
              vive en `.wa-conv-bg` (que queda quieto) y los mensajes van en
              el hijo `.wa-conv-scroll`, exactamente como WhatsApp Web.
            */}
            <div className="wa-conv-bg flex min-h-0 flex-1 flex-col">
              <div
                ref={scrollRef}
                className="wa-conv-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-4 py-4 sm:px-8"
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
                    channel={selected.channel}
                    onEdit={startEdit}
                    onForward={setForwarding}
                  />
                )}
              </div>
            </div>

            <div className="shrink-0 bg-[var(--wa-composer)]">
              {/*
                Cinta de edición: mientras está enganchada, el campo de abajo
                reescribe ese mensaje en vez de mandar uno nuevo. Es la misma
                señal que usa WhatsApp Web para que nadie se confunda de gesto.
              */}
              {editing ? (
                <div className="flex items-center gap-2 border-b border-[var(--wa-divider)] px-3 py-2 sm:px-4">
                  <Pencil className="size-4 shrink-0 text-[var(--wa-accent-strong)]" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-[0.8125rem] font-medium text-[var(--wa-accent-strong)]">
                      Editando mensaje
                    </div>
                    <div className="truncate text-[0.8125rem] text-[var(--wa-text-2)]">
                      {editing.body}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    aria-label="Cancelar la edición"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : null}

              <form
                onSubmit={handleSend}
                className="wa-composer flex items-center gap-1.5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:gap-2 sm:px-4 md:pb-2"
              >
                {/* Editando no se adjuntan archivos: WhatsApp sólo deja
                    cambiar el texto de un mensaje ya mandado. */}
                {editing ? null : (
                  <>
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
                  </>
                )}
                {/*
                  A propósito no se deshabilita mientras se envía: `disabled`
                  le saca el foco al input y obliga a volver a clickear para
                  escribir el mensaje siguiente.
                */}
                <Input
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && editing) {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  placeholder={
                    editing ? "Editá el mensaje" : "Escribí un mensaje"
                  }
                  autoComplete="off"
                  className="min-w-0 flex-1 border-transparent bg-[var(--wa-composer-field)] text-[var(--wa-text)] placeholder:text-[var(--wa-text-2)]"
                />
                <Button
                  type="submit"
                  disabled={draft.trim().length === 0}
                  size="icon"
                  className="shrink-0 rounded-full bg-[var(--wa-accent)] text-white hover:bg-[var(--wa-accent-strong)]"
                >
                  {editing ? (
                    <Check className="size-4" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  <span className="sr-only">
                    {editing ? "Guardar la edición" : "Enviar"}
                  </span>
                </Button>
              </form>
            </div>
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

      <ForwardDialog
        message={forwarding}
        conversations={conversations}
        currentConversationId={selectedId}
        titleOf={conversationTitle}
        onOpenChange={(open) => {
          if (!open) setForwarding(null);
        }}
      />
    </div>
  );
}

function MessagesRender({
  messages,
  conversationId,
  channel,
  onEdit,
  onForward,
}: {
  messages: MessageRow[];
  conversationId: string;
  channel: string;
  onEdit: (message: MessageRow) => void;
  onForward: (message: MessageRow) => void;
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
      <div className="py-8 text-center text-sm text-[var(--wa-text-2)]">
        Sin mensajes todavía. Mandá el primero ↓
      </div>
    );
  }

  // Group by day for separators.
  //
  // `tail` marca el primer mensaje de cada tanda del mismo lado: es el único
  // que lleva el piquito, igual que WhatsApp. Un separador de día corta la
  // tanda, así el mensaje que lo sigue vuelve a llevarlo.
  const items: Array<
    | { kind: "day"; label: string; key: string }
    | { kind: "msg"; m: MessageRow; tail: boolean }
  > = [];
  let lastDay = "";
  let lastDirection: MessageRow["direction"] | null = null;
  for (const m of visible) {
    const day = messageDayLabel(m.sent_at);
    if (day !== lastDay) {
      items.push({ kind: "day", label: day, key: `day-${m.id}` });
      lastDay = day;
      lastDirection = null;
    }
    items.push({ kind: "msg", m, tail: m.direction !== lastDirection });
    lastDirection = m.direction;
  }

  return (
    <>
      {items.map((it) =>
        it.kind === "day" ? (
          <div key={it.key} className="my-3 flex justify-center">
            <span className="rounded-lg bg-[var(--wa-system-bubble)] px-3 py-1 text-[0.75rem] text-[var(--wa-system-text)] shadow-[var(--wa-bubble-shadow)]">
              {it.label}
            </span>
          </div>
        ) : (
          <Bubble
            key={it.m.id}
            message={it.m}
            conversationId={conversationId}
            channel={channel}
            onEdit={onEdit}
            onForward={onForward}
            tail={it.tail}
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
        "-mx-1 mb-1 flex items-start gap-1.5 rounded-md border-l-[3px] px-2 py-1 text-xs",
        "bg-black/5 text-[var(--wa-text-2)] dark:bg-white/5",
        isOutbound
          ? "border-[var(--wa-accent-strong)]"
          : "border-[var(--wa-accent)]",
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
  channel,
  replyTo,
  reactions,
  tail,
  onEdit,
  onForward,
}: {
  message: MessageRow;
  conversationId: string;
  channel: string;
  replyTo: MessageRow | null;
  reactions: Record<string, number> | null;
  /** Primer mensaje de la tanda: es el que lleva el piquito. */
  tail: boolean;
  onEdit: (message: MessageRow) => void;
  onForward: (message: MessageRow) => void;
}) {
  const isOutbound = message.direction === "outbound";
  const revoked = !!message.revoked_at;
  const isMedia = !revoked && message.type !== "text" && !!message.media_url;
  // We can only react to messages that have been confirmed by WhatsApp
  // (i.e. they have an external_id we can reference in the reaction key).
  const canReact = !!message.external_id && !revoked;

  const actions = (
    <MessageActions
      message={message}
      channel={channel}
      alignEnd={isOutbound}
      onEdit={() => onEdit(message)}
      onForward={() => onForward(message)}
    />
  );

  return (
    <div
      className={cn(
        "group flex items-end gap-1.5",
        isOutbound ? "justify-end" : "justify-start",
      )}
    >
      {/* Picker on the outbound side — left of bubble */}
      {isOutbound ? (
        <>
          {actions}
          {canReact ? (
            <ReactionPicker
              conversationId={conversationId}
              targetExternalId={message.external_id!}
              alignRight
            />
          ) : null}
        </>
      ) : null}

      <div
        className={cn(
          "relative max-w-[78%] rounded-lg px-2 py-1.5 text-[var(--wa-text)] shadow-[var(--wa-bubble-shadow)]",
          isOutbound
            ? "bg-[var(--wa-bubble-out)]"
            : "bg-[var(--wa-bubble-in)]",
          // El piquito recorta la esquina superior del lado que corresponde.
          tail && (isOutbound ? "wa-tail-out rounded-tr-none" : "wa-tail-in rounded-tl-none"),
          !revoked && message.status === "failed" && "bg-red-50 ring-1 ring-red-200",
          isMedia && "px-2 pt-2 pb-1.5",
        )}
      >
        {revoked ? (
          /*
            El mensaje eliminado no se borra de la conversación: deja el hueco
            con el aviso, igual que WhatsApp. La hora se queda para que el
            hilo no pierda el ritmo de la charla.
          */
          <div className="flex items-center gap-1.5 pr-1 text-sm italic text-[var(--wa-text-2)]">
            <Ban className="size-3.5 shrink-0" />
            {isOutbound
              ? "Eliminaste este mensaje"
              : "Se eliminó este mensaje"}
          </div>
        ) : (
          <>
            {message.forwarded ? (
              <div className="mb-0.5 flex items-center gap-1 text-[0.75rem] italic text-[var(--wa-text-2)]">
                <Forward className="size-3" />
                Reenviado
              </div>
            ) : null}
            {replyTo ? (
              <ReplyPreview message={replyTo} isOutbound={isOutbound} />
            ) : null}
            <MessageContent message={message} />
          </>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[var(--wa-meta)]">
          {message.edited_at && !revoked ? (
            <span className="text-[0.6875rem] italic">editado</span>
          ) : null}
          <span className="text-[0.6875rem] tabular-nums">
            {format(new Date(message.sent_at), "HH:mm")}
          </span>
          {isOutbound && !revoked ? (
            <StatusIcon status={message.status} />
          ) : null}
        </div>
        {!revoked && message.status === "failed" && message.error ? (
          <div
            className="mt-0.5 text-[0.6875rem] text-destructive"
            title={message.error}
          >
            Error · {message.error.slice(0, 60)}
          </div>
        ) : null}

        {reactions && !revoked ? (
          <ReactionsPill
            counts={reactions}
            className={cn(
              "absolute -bottom-2.5",
              isOutbound ? "right-2" : "left-2",
            )}
          />
        ) : null}
      </div>

      {!isOutbound ? (
        <>
          {canReact ? (
            <ReactionPicker
              conversationId={conversationId}
              targetExternalId={message.external_id!}
            />
          ) : null}
          {actions}
        </>
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
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] transition-colors md:h-7 md:px-3",
        active
          ? "bg-[var(--wa-chip-on)] text-[var(--wa-chip-on-text)]"
          : "bg-[var(--wa-search-bg)] text-[var(--wa-text-2)] hover:bg-[var(--wa-active)]",
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
      className="h-[150px] w-[240px] text-[var(--wa-border)]"
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
        fill="var(--wa-panel)"
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
