"use client";

import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { Scissors, Search, Users, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChipRow,
  Fab,
  FilterChip,
  PhoneEmpty,
  PhoneGroup,
  PhoneHeader,
  PhoneRow,
  PhoneScreen,
  PhoneSection,
  Pill,
  PILL_TONE,
  PillButton,
  Segmented,
} from "@/components/dashboard/phone-screen";
import { formatCurrency, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, SERVICE_CATEGORIES } from "@/lib/validations/services";
import { ServiceDialog } from "../servicios/service-dialog";
import type { ServiceRow } from "../servicios/types";
import { ClientDialog } from "./client-dialog";
import { CLIENT_SORTS, type ClientSort } from "./sort";
import type { ClientRow } from "./types";

type Segment = "clientas" | "servicios";

const SEGMENTS = [
  { value: "clientas", label: "Clientas" },
  { value: "servicios", label: "Servicios" },
] as const;

/**
 * Clientas y servicios para teléfono.
 *
 * En el escritorio son dos tablas en solapas; acá es la pantalla de contactos
 * de WhatsApp, con el mismo encabezado que la agenda y la bandeja:
 *
 *   ┌───────────────────────────────┐
 *   │           Clientas│Servicios (A)│  ← la solapa, arriba como "Día│Sem"
 *   │ Clientas                      │
 *   │ ( 🔍 Buscá por nombre o tel.) │
 *   │ (A–Z) (Recientes) (Frecuentes)│  ← el orden lo resuelve el servidor
 *   ├───────────────────────────────┤
 *   │ A                             │  ← letra pegada arriba, en A–Z
 *   │ (AG) Ana García     hace 2 sem │
 *   │      351 555-1234   8 · $96.000│
 *   └───────────────────────────────┘
 *
 * Servicios van por categoría, con el precio a la derecha. Tocar una fila
 * abre su ficha; el botón flotante da de alta en la solapa que se está viendo.
 */
export function PhoneClientas({
  clients,
  services,
  query,
  sort,
  limit,
}: {
  clients: ClientRow[];
  services: ServiceRow[];
  query: string;
  sort: ClientSort;
  /** Cuántas filas trae el servidor como máximo. */
  limit: number;
}) {
  const [segment, setSegment] = useState<Segment>("clientas");

  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceRow | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);

  function openClient(client: ClientRow | null) {
    setEditingClient(client);
    setClientOpen(true);
  }

  function openService(service: ServiceRow | null) {
    setEditingService(service);
    setServiceOpen(true);
  }

  // La búsqueda y el orden viajan en la URL: los resuelve el servidor, que es
  // el único que ve más allá de las primeras filas.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startLoading] = useTransition();

  function pushParams(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    startLoading(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }

  const [category, setCategory] = useState<string>("all");

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Cambiar de solapa o de orden vuelve arriba: la lista es otra.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [segment, sort, category]);

  return (
    <PhoneScreen
      scrollRef={scrollerRef}
      header={
        <PhoneHeader
          actions={
            <span className="mr-1">
              <Segmented
                value={segment}
                options={SEGMENTS}
                onChange={setSegment}
              />
            </span>
          }
          title={segment === "clientas" ? "Clientas" : "Servicios"}
        >
          {segment === "clientas" ? (
            <>
              <SearchField
                initial={query}
                onSearch={(q) => pushParams({ q })}
              />
              <ChipRow>
                {CLIENT_SORTS.map((option) => (
                  <FilterChip
                    key={option.value}
                    active={sort === option.value}
                    onClick={() =>
                      pushParams({
                        orden: option.value === "az" ? "" : option.value,
                      })
                    }
                  >
                    {option.label}
                  </FilterChip>
                ))}
              </ChipRow>
            </>
          ) : (
            <ServiceChips
              services={services}
              value={category}
              onChange={setCategory}
            />
          )}
        </PhoneHeader>
      }
      fab={
        <Fab
          label={segment === "clientas" ? "Nueva clienta" : "Nuevo servicio"}
          onClick={() =>
            segment === "clientas" ? openClient(null) : openService(null)
          }
        />
      }
    >
      <div className={cn("transition-opacity", loading && "opacity-60")}>
        {segment === "clientas" ? (
          <ClientList
            clients={clients}
            query={query}
            sort={sort}
            limit={limit}
            onOpen={openClient}
            onCreate={() => openClient(null)}
          />
        ) : (
          <ServiceList
            services={services}
            category={category}
            onOpen={openService}
            onCreate={() => openService(null)}
          />
        )}
      </div>

      <ClientDialog
        open={clientOpen}
        onOpenChange={(open) => {
          setClientOpen(open);
          if (!open) setEditingClient(null);
        }}
        client={editingClient}
      />
      <ServiceDialog
        open={serviceOpen}
        onOpenChange={(open) => {
          setServiceOpen(open);
          if (!open) setEditingService(null);
        }}
        service={editingService}
      />
    </PhoneScreen>
  );
}

/** El buscador de WhatsApp: píldora ancha, con la lupa adentro. */
function SearchField({
  initial,
  onSearch,
}: {
  initial: string;
  onSearch: (query: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Atrás/adelante del navegador cambian la URL sin pasar por acá.
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setValue(initial);
  }

  function change(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(next.trim()), 300);
  }

  function clear() {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch("");
  }

  return (
    <div className="px-4 pb-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[var(--wa-text-3)]" />
        <input
          type="search"
          value={value}
          onChange={(e) => change(e.target.value)}
          placeholder="Buscá por nombre o teléfono"
          aria-label="Buscá por nombre o teléfono"
          enterKeyHint="search"
          className="h-11 w-full rounded-full border border-transparent bg-[var(--wa-search-bg)] pr-11 pl-12 text-[0.9375rem] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] focus:border-[var(--wa-divider)] focus:bg-[var(--wa-search-field)] [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Limpiar búsqueda"
            className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--wa-text-2)] active:bg-[var(--wa-hover)]"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** "Hoy" · "Ayer" · "hace 5 días" · "hace 3 sem" · "mar 2025". */
function lastVisitLabel(iso: string | null, now: Date): string {
  if (!iso) return "Sin visitas";
  const date = new Date(iso);
  const days = differenceInCalendarDays(now, date);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.floor(days / 7)} sem`;
  return format(
    date,
    now.getFullYear() === date.getFullYear() ? "d MMM" : "MMM yyyy",
    {
      locale: es,
    },
  );
}

/** La letra con la que se agrupa en A–Z: sin tildes, y los raros en "#". */
function letterOf(name: string): string {
  const letter = name
    .trim()
    .charAt(0)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
  return /[A-ZÑ]/.test(letter) ? letter : "#";
}

function ClientList({
  clients,
  query,
  sort,
  limit,
  onOpen,
  onCreate,
}: {
  clients: ClientRow[];
  query: string;
  sort: ClientSort;
  limit: number;
  onOpen: (client: ClientRow) => void;
  onCreate: () => void;
}) {
  // Sólo para las etiquetas relativas ("hace 2 sem"): con el reloj de cuando
  // llegó la lista alcanza.
  const [now] = useState(() => new Date());

  const groups = useMemo(() => {
    if (sort !== "az") return [{ key: "", list: clients }];
    const map = new Map<string, ClientRow[]>();
    for (const client of clients) {
      const key = letterOf(client.full_name);
      const list = map.get(key);
      if (list) list.push(client);
      else map.set(key, [client]);
    }
    return [...map.entries()].map(([key, list]) => ({ key, list }));
  }, [clients, sort]);

  if (clients.length === 0) {
    return query ? (
      <PhoneEmpty icon={Search} title={`Sin resultados para "${query}"`}>
        Probá con otro nombre, o con el teléfono sin el 0 ni el 15.
      </PhoneEmpty>
    ) : (
      <PhoneEmpty
        icon={Users}
        title="Todavía no hay clientas"
        action={<PillButton onClick={onCreate}>Cargar la primera</PillButton>}
      >
        Cargá tu primera clienta. Después la vas a poder asignar a un turno.
      </PhoneEmpty>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.key || "all"}>
          {group.key ? (
            <h2 className="sticky top-0 z-10 bg-[var(--wa-panel)]/90 px-4 pt-3 pb-1 text-[0.8125rem] font-semibold text-[var(--wa-badge)] backdrop-blur-md">
              {group.key}
            </h2>
          ) : null}
          <ul>
            {group.list.map((client) => (
              <ClientItem
                key={client.id}
                client={client}
                sort={sort}
                now={now}
                onOpen={() => onOpen(client)}
              />
            ))}
          </ul>
        </section>
      ))}
      {clients.length >= limit ? (
        <p className="px-8 pt-4 text-center text-[0.75rem] leading-relaxed text-balance text-[var(--wa-text-3)]">
          Se muestran las primeras {limit}. Para encontrar a otra, buscala por
          nombre o teléfono.
        </p>
      ) : null}
    </>
  );
}

/**
 * Una clienta, como un contacto de WhatsApp: el avatar con las iniciales, el
 * nombre y debajo cómo encontrarla. A la derecha, lo que dice el orden
 * elegido — cuándo vino por última vez, o cuánto viene, o cuánto dejó.
 */
function ClientItem({
  client: c,
  sort,
  now,
  onOpen,
}: {
  client: ClientRow;
  sort: ClientSort;
  now: Date;
  onOpen: () => void;
}) {
  const contact = c.phone || c.email || c.instagram_handle || "Sin contacto";
  const visits = `${c.total_visits} visita${c.total_visits === 1 ? "" : "s"}`;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 text-left active:bg-[var(--wa-hover)]"
      >
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--wa-avatar-bg)] text-[0.9375rem] font-medium text-[var(--wa-avatar-fg)]"
        >
          {initials(c.full_name)}
        </span>
        {/* El filete arranca después del avatar, como en WhatsApp. */}
        <span className="min-w-0 flex-1 border-b border-[var(--wa-divider)] py-3 [li:last-child_&]:border-b-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.9375rem]">{c.full_name}</span>
            <span className="shrink-0 text-[0.6875rem] text-[var(--wa-text-2)] tabular-nums">
              {sort === "gasto"
                ? formatCurrency(c.total_spent)
                : sort === "visitas"
                  ? visits
                  : lastVisitLabel(c.last_visit_at, now)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[0.8125rem] text-[var(--wa-text-2)] tabular-nums">
                {contact}
              </span>
              {c.tags.slice(0, 2).map((tag) => (
                <Pill key={tag} className={cn(PILL_TONE.neutral, "shrink-0")}>
                  {tag}
                </Pill>
              ))}
            </span>
            <span className="shrink-0 text-[0.75rem] text-[var(--wa-text-3)] tabular-nums">
              {sort === "visitas" || sort === "gasto"
                ? lastVisitLabel(c.last_visit_at, now)
                : c.total_visits > 0
                  ? visits
                  : null}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function ServiceChips({
  services,
  value,
  onChange,
}: {
  services: ServiceRow[];
  value: string;
  onChange: (value: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const s of services) {
    if (!s.active) continue;
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  }
  const used = SERVICE_CATEGORIES.filter((c) => counts.has(c.value));
  if (used.length < 2) return null;

  return (
    <ChipRow>
      <FilterChip active={value === "all"} onClick={() => onChange("all")}>
        Todos
        <span className="tabular-nums opacity-70">
          {services.filter((s) => s.active).length}
        </span>
      </FilterChip>
      {used.map((c) => (
        <FilterChip
          key={c.value}
          active={value === c.value}
          onClick={() => onChange(value === c.value ? "all" : c.value)}
        >
          {c.label}
          <span className="tabular-nums opacity-70">{counts.get(c.value)}</span>
        </FilterChip>
      ))}
    </ChipRow>
  );
}

/**
 * Servicios por categoría, en el orden del alta de turnos. Los archivados van
 * al final y apagados: siguen existiendo para los turnos viejos.
 */
function ServiceList({
  services,
  category,
  onOpen,
  onCreate,
}: {
  services: ServiceRow[];
  category: string;
  onOpen: (service: ServiceRow) => void;
  onCreate: () => void;
}) {
  if (services.length === 0) {
    return (
      <PhoneEmpty
        icon={Scissors}
        title="Todavía no hay servicios"
        action={<PillButton onClick={onCreate}>Cargar el primero</PillButton>}
      >
        Cargá lo que ofrece la peluquería con su duración y su precio. Después
        los vas a poder asignar a los turnos.
      </PhoneEmpty>
    );
  }

  const visible = services.filter(
    (s) => category === "all" || s.category === category,
  );
  const active = visible.filter((s) => s.active);
  const archived = visible.filter((s) => !s.active);
  const sections = SERVICE_CATEGORIES.map((c) => ({
    ...c,
    list: active.filter((s) => s.category === c.value),
  })).filter((c) => c.list.length > 0);

  return (
    <>
      {sections.map((section) => (
        <PhoneSection
          key={section.value}
          title={section.label}
          meta={section.list.length}
          className="first:pt-2"
        >
          <PhoneGroup>
            {section.list.map((service) => (
              <ServiceItem
                key={service.id}
                service={service}
                onOpen={() => onOpen(service)}
              />
            ))}
          </PhoneGroup>
        </PhoneSection>
      ))}
      {archived.length > 0 ? (
        <PhoneSection title="Archivados" meta={archived.length}>
          <PhoneGroup>
            {archived.map((service) => (
              <ServiceItem
                key={service.id}
                service={service}
                showCategory={category === "all"}
                onOpen={() => onOpen(service)}
              />
            ))}
          </PhoneGroup>
        </PhoneSection>
      ) : null}
    </>
  );
}

function ServiceItem({
  service: s,
  showCategory = false,
  onOpen,
}: {
  service: ServiceRow;
  showCategory?: boolean;
  onOpen: () => void;
}) {
  const detail = [
    showCategory ? CATEGORY_LABEL[s.category] : null,
    formatDuration(s.duration_minutes),
    s.description,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PhoneRow
      onClick={onOpen}
      muted={!s.active}
      title={s.name}
      subtitle={detail}
      trailing={
        <span className="shrink-0 text-[0.9375rem] font-medium tabular-nums">
          {Number(s.price) > 0 ? formatCurrency(s.price) : "A definir"}
        </span>
      }
    />
  );
}
