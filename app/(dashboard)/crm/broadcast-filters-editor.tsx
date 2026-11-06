"use client";

import {
  CalendarClock,
  CalendarHeart,
  CalendarPlus,
  CircleDollarSign,
  Filter,
  Hash,
  MessageCircle,
  Plus,
  Scissors,
  Tag,
  UserPlus,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  type BroadcastCondition,
  type BroadcastConditionType,
  broadcastConditionSchema,
  type BroadcastFilters,
  CONDITION_LABEL,
  CONDITION_TYPES,
  defaultCondition,
  MONTHS,
} from "@/lib/broadcasts/filters";
import { cn } from "@/lib/utils";
import type { ClientTag, ProfessionalSlim, ServiceSlim } from "./config-types";

const CONDITION_ICON: Record<BroadcastConditionType, LucideIcon> = {
  tags: Tag,
  last_visit: CalendarClock,
  services: Scissors,
  professionals: UserRound,
  visits: Hash,
  spent: CircleDollarSign,
  birthday: CalendarHeart,
  new_clients: UserPlus,
  upcoming: CalendarPlus,
  chat_window: MessageCircle,
};

/** Los períodos que ofrecen los filtros de servicios y profesional. */
const PERIODS: { value: string; label: string; days: number | null }[] = [
  { value: "any", label: "Alguna vez", days: null },
  { value: "30", label: "En los últimos 30 días", days: 30 },
  { value: "60", label: "En los últimos 60 días", days: 60 },
  { value: "90", label: "En los últimos 3 meses", days: 90 },
  { value: "180", label: "En los últimos 6 meses", days: 180 },
  { value: "365", label: "En el último año", days: 365 },
];

function periodValue(days: number | null): string {
  return PERIODS.find((p) => p.days === days)?.value ?? "any";
}

/** Un número de un input, o null si quedó vacío. */
function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Días de un input. Vacío queda en 0, que el esquema marca como error. */
function daysOf(raw: string): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * El armado del segmento de una difusión.
 *
 * Componente controlado: el diálogo es el dueño del estado porque además lo
 * manda a calcular la vista previa. Cada condición se valida sola contra el
 * mismo esquema que usa el servidor, así el error aparece debajo de la fila
 * que hay que corregir y no como un "filtros inválidos" genérico.
 */
export function BroadcastFiltersEditor({
  value,
  onChange,
  tags,
  services,
  professionals,
}: {
  value: BroadcastFilters;
  onChange: (next: BroadcastFilters) => void;
  tags: ClientTag[];
  services: ServiceSlim[];
  professionals: ProfessionalSlim[];
}) {
  const activeTags = tags.filter((t) => t.active);

  function setCondition(index: number, next: BroadcastCondition) {
    onChange({
      ...value,
      conditions: value.conditions.map((c, i) => (i === index ? next : c)),
    });
  }

  function removeCondition(index: number) {
    onChange({
      ...value,
      conditions: value.conditions.filter((_, i) => i !== index),
    });
  }

  function addCondition(type: BroadcastConditionType) {
    onChange({
      ...value,
      conditions: [...value.conditions, defaultCondition(type)],
    });
  }

  function toggleExcludeTag(name: string) {
    onChange({
      ...value,
      excludeTags: value.excludeTags.includes(name)
        ? value.excludeTags.filter((t) => t !== name)
        : [...value.excludeTags, name],
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {value.conditions.length >= 2 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Que cumplan</span>
            <Select
              value={value.match}
              onValueChange={(v) =>
                onChange({ ...value, match: v as BroadcastFilters["match"] })
              }
            >
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todas las condiciones</SelectItem>
                <SelectItem value="any">alguna de las condiciones</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {value.conditions.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
            <Filter className="mt-0.5 size-4 shrink-0 text-gold" />
            <p>
              Sin filtros, la difusión le llega a{" "}
              <strong className="text-foreground">
                todas las clientas con teléfono
              </strong>
              . Agregá condiciones para armar un segmento: las que tienen cierta
              etiqueta, las que no vienen hace dos meses, las que se hicieron
              color…
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {value.conditions.map((condition, index) => (
              <ConditionRow
                key={index}
                index={index}
                condition={condition}
                joiner={
                  index === 0 ? null : value.match === "all" ? "y" : "o"
                }
                onChange={(next) => setCondition(index, next)}
                onRemove={() => removeCondition(index)}
                tags={activeTags}
                services={services}
                professionals={professionals}
              />
            ))}
          </ul>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus className="size-4" />
              Agregar filtro
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {CONDITION_TYPES.map((c) => {
              const Icon = CONDITION_ICON[c.type];
              return (
                <DropdownMenuItem
                  key={c.type}
                  onSelect={() => addCondition(c.type)}
                  className="items-start"
                >
                  <Icon className="mt-0.5 size-4" />
                  <span className="flex flex-col">
                    <span>{c.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {c.hint}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
        <Label>Nunca mandarle a</Label>
        {activeTags.length === 0 && value.excludeTags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Creá una etiqueta como &quot;No molestar&quot; en la pestaña
            Etiquetas para poder excluir a las clientas que no quieren
            promociones.
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Las que tengan alguna de estas etiquetas, aunque cumplan los
              filtros.
            </p>
            <TagChips
              tags={activeTags}
              selected={value.excludeTags}
              onToggle={toggleExcludeTag}
              tone="exclude"
            />
          </div>
        )}
        {/*
          El número va dentro de la frase y la frase se corta como texto: en
          el teléfono no queda un renglón por pieza.
        */}
        <div className="flex items-start gap-2 pt-1 text-sm">
          <Checkbox
            id="exclude-recent"
            className="mt-1.5"
            checked={value.excludeRecentDays !== null}
            onCheckedChange={(checked) =>
              onChange({ ...value, excludeRecentDays: checked ? 7 : null })
            }
          />
          <p className="leading-8">
            <label htmlFor="exclude-recent">
              Quienes recibieron otra difusión en los últimos
            </label>{" "}
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label="Días sin difusiones"
              className="inline-flex h-8 w-16 align-middle tabular-nums"
              disabled={value.excludeRecentDays === null}
              value={value.excludeRecentDays ?? 7}
              onChange={(e) =>
                onChange({ ...value, excludeRecentDays: daysOf(e.target.value) })
              }
            />{" "}
            días
          </p>
        </div>
      </div>
    </div>
  );
}

function ConditionRow({
  index,
  condition,
  joiner,
  onChange,
  onRemove,
  tags,
  services,
  professionals,
}: {
  index: number;
  condition: BroadcastCondition;
  joiner: "y" | "o" | null;
  onChange: (next: BroadcastCondition) => void;
  onRemove: () => void;
  tags: ClientTag[];
  services: ServiceSlim[];
  professionals: ProfessionalSlim[];
}) {
  const Icon = CONDITION_ICON[condition.type];
  const check = broadcastConditionSchema.safeParse(condition);
  const error = check.success ? null : check.error.issues[0]?.message;

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        {joiner ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {joiner}
          </span>
        ) : null}
        <Icon className="size-4 text-gold" />
        <span className="text-sm font-medium">
          {CONDITION_LABEL[condition.type]}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onRemove}
          aria-label={`Quitar el filtro ${CONDITION_LABEL[condition.type]}`}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-2">
        <ConditionFields
          idPrefix={`cond-${index}`}
          condition={condition}
          onChange={onChange}
          tags={tags}
          services={services}
          professionals={professionals}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-destructive">{error}</p>
      ) : null}
    </li>
  );
}

function ConditionFields({
  idPrefix,
  condition: c,
  onChange,
  tags,
  services,
  professionals,
}: {
  idPrefix: string;
  condition: BroadcastCondition;
  onChange: (next: BroadcastCondition) => void;
  tags: ClientTag[];
  services: ServiceSlim[];
  professionals: ProfessionalSlim[];
}) {
  switch (c.type) {
    case "tags":
      return (
        <div className="space-y-2">
          <Select
            value={c.mode}
            onValueChange={(v) =>
              onChange({ ...c, mode: v as "any" | "all" })
            }
          >
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Tiene alguna de estas</SelectItem>
              <SelectItem value="all">Tiene todas estas</SelectItem>
            </SelectContent>
          </Select>
          {tags.length === 0 && c.tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay etiquetas activas. Se crean en la pestaña Etiquetas.
            </p>
          ) : (
            <TagChips
              tags={tags}
              selected={c.tags}
              onToggle={(name) =>
                onChange({
                  ...c,
                  tags: c.tags.includes(name)
                    ? c.tags.filter((t) => t !== name)
                    : [...c.tags, name],
                })
              }
            />
          )}
        </div>
      );

    case "last_visit":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select
            value={c.mode}
            onValueChange={(v) =>
              onChange({ ...c, mode: v as "within" | "over" | "never" })
            }
          >
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="over">No viene hace más de</SelectItem>
              <SelectItem value="within">Vino en los últimos</SelectItem>
              <SelectItem value="never">Nunca vino</SelectItem>
            </SelectContent>
          </Select>
          {c.mode !== "never" ? (
            <>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                className="h-8 w-20 tabular-nums"
                value={c.days || ""}
                onChange={(e) => onChange({ ...c, days: daysOf(e.target.value) })}
              />
              <span>días</span>
            </>
          ) : null}
        </div>
      );

    case "visits":
    case "spent":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {c.type === "visits" ? "Visitas" : "Gastó"} entre
          </span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="mín."
            className="h-8 w-24 tabular-nums"
            value={c.min ?? ""}
            onChange={(e) => onChange({ ...c, min: numberOrNull(e.target.value) })}
          />
          <span className="text-muted-foreground">y</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="máx."
            className="h-8 w-24 tabular-nums"
            value={c.max ?? ""}
            onChange={(e) => onChange({ ...c, max: numberOrNull(e.target.value) })}
          />
          {c.type === "spent" ? (
            <span className="text-xs text-muted-foreground">pesos</span>
          ) : null}
          <span className="basis-full text-[11px] text-muted-foreground">
            Dejá un lado vacío para &quot;sin límite&quot;.
          </span>
        </div>
      );

    case "services":
      return (
        <div className="space-y-2">
          <CheckList
            idPrefix={idPrefix}
            items={services.map((s) => ({ id: s.id, label: s.name }))}
            selected={c.serviceIds}
            empty="No hay servicios activos cargados."
            onChange={(serviceIds) => onChange({ ...c, serviceIds })}
          />
          <PeriodSelect
            value={c.withinDays}
            onChange={(withinDays) => onChange({ ...c, withinDays })}
          />
        </div>
      );

    case "professionals":
      return (
        <div className="space-y-2">
          <CheckList
            idPrefix={idPrefix}
            items={professionals.map((p) => ({ id: p.id, label: p.full_name }))}
            selected={c.professionalIds}
            empty="No hay profesionales activas cargadas."
            onChange={(professionalIds) => onChange({ ...c, professionalIds })}
          />
          <PeriodSelect
            value={c.withinDays}
            onChange={(withinDays) => onChange({ ...c, withinDays })}
          />
        </div>
      );

    case "birthday":
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map((month, i) => {
              const n = i + 1;
              const active = c.months.includes(n);
              return (
                <Chip
                  key={month}
                  active={active}
                  onClick={() =>
                    onChange({
                      ...c,
                      months: active
                        ? c.months.filter((m) => m !== n)
                        : [...c.months, n],
                    })
                  }
                >
                  {month.slice(0, 3)}
                </Chip>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Solo cuentan las clientas con la fecha de cumpleaños cargada en la
            ficha.
          </p>
        </div>
      );

    case "new_clients":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Cargadas en los últimos</span>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            className="h-8 w-20 tabular-nums"
            value={c.days || ""}
            onChange={(e) => onChange({ ...c, days: daysOf(e.target.value) })}
          />
          <span>días</span>
        </div>
      );

    case "upcoming":
      return (
        <Select
          value={c.has ? "yes" : "no"}
          onValueChange={(v) => onChange({ ...c, has: v === "yes" })}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no">No tiene turno agendado</SelectItem>
            <SelectItem value="yes">Tiene turno agendado</SelectItem>
          </SelectContent>
        </Select>
      );

    case "chat_window":
      return (
        <div className="space-y-1.5">
          <Select
            value={c.open ? "yes" : "no"}
            onValueChange={(v) => onChange({ ...c, open: v === "yes" })}
          >
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Escribió en las últimas 24 h</SelectItem>
              <SelectItem value="no">No escribió en las últimas 24 h</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Al WhatsApp nuevo. Son las únicas a las que les llega un mensaje
            libre sin plantilla.
          </p>
        </div>
      );
  }
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (days: number | null) => void;
}) {
  return (
    <Select
      value={periodValue(value)}
      onValueChange={(v) =>
        onChange(PERIODS.find((p) => p.value === v)?.days ?? null)
      }
    >
      <SelectTrigger size="sm" className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CheckList({
  idPrefix,
  items,
  selected,
  empty,
  onChange,
}: {
  idPrefix: string;
  items: { id: string; label: string }[];
  selected: string[];
  empty: string;
  onChange: (next: string[]) => void;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border">
      <ul className="divide-y">
        {items.map((item) => {
          const checked = selected.includes(item.id);
          const id = `${idPrefix}-${item.id}`;
          return (
            <li key={item.id}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/30"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() =>
                    onChange(
                      checked
                        ? selected.filter((s) => s !== item.id)
                        : [...selected, item.id],
                    )
                  }
                />
                <span className="text-sm">{item.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Las etiquetas como pastillas. Una etiqueta elegida que ya no está entre las
 * activas (se archivó después de armar la difusión) se sigue mostrando, para
 * poder sacarla.
 */
function TagChips({
  tags,
  selected,
  onToggle,
  tone = "include",
}: {
  tags: ClientTag[];
  selected: string[];
  onToggle: (name: string) => void;
  tone?: "include" | "exclude";
}) {
  const names = [
    ...tags.map((t) => t.name),
    ...selected.filter((name) => !tags.some((t) => t.name === name)),
  ];
  const colorOf = new Map(tags.map((t) => [t.name, t.color]));

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <Chip
          key={name}
          active={selected.includes(name)}
          tone={tone}
          onClick={() => onToggle(name)}
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: colorOf.get(name) ?? "var(--muted-foreground)" }}
          />
          {name}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  tone = "include",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "include" | "exclude";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? tone === "exclude"
            ? "border-destructive/60 bg-destructive/10 text-destructive"
            : "border-gold bg-gold/10 text-foreground"
          : "bg-background text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}
