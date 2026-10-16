"use client";

import { Bell, ChevronLeft, Smartphone, Zap } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";
import {
  PhoneGroup,
  PhoneHeader,
  PhoneRow,
  PhoneScreen,
  PhoneSection,
} from "@/components/dashboard/phone-screen";
import { InstagramIcon } from "@/components/icons/instagram";
import { cn } from "@/lib/utils";

/** Cómo está una integración, en una palabra y un color. */
export type SettingsStatus = {
  tone: "ok" | "warn" | "error" | "off";
  label: string;
};

export type SettingsItem = {
  id: string;
  title: string;
  icon: "whatsapp-cloud" | "instagram" | "whatsapp" | "notifications";
  status?: SettingsStatus;
  /** Lo que va después del estado: el número, la cuenta. */
  detail?: string | null;
  panel: ReactNode;
};

export type SettingsGroup = { title: string; items: SettingsItem[] };

const ICONS: Record<
  SettingsItem["icon"],
  { icon: ComponentType<{ className?: string }>; tone: string }
> = {
  "whatsapp-cloud": { icon: Zap, tone: "bg-emerald-400/15 text-emerald-300" },
  instagram: {
    icon: InstagramIcon,
    tone: "bg-fuchsia-400/15 text-fuchsia-300",
  },
  whatsapp: { icon: Smartphone, tone: "bg-white/10 text-[var(--wa-text-2)]" },
  notifications: { icon: Bell, tone: "bg-amber-400/15 text-amber-300" },
};

const DOT: Record<SettingsStatus["tone"], string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  error: "bg-rose-400",
  off: "bg-white/25",
};

/**
 * Configuración en sus dos formas.
 *
 * En el escritorio es la columna de paneles de siempre. En el teléfono son los
 * ajustes de WhatsApp: una lista agrupada, cada integración con su estado, y
 * al tocar una se entra a su panel con el título arriba y "‹ Configuración"
 * para volver.
 *
 *   ┌───────────────────────────────┐        ┌───────────────────────────────┐
 *   │ Configuración              (A)│        │ ‹ Configuración            (A)│
 *   │ Integraciones                 │   →    │ WhatsApp API                  │
 *   │ (⚡) WhatsApp API  ● Conectado ›│        │ ╭ panel ────────────────────╮ │
 *   │ (◎) Instagram     ○ Descon.  ›│        │ │ …                         │ │
 *   └───────────────────────────────┘        └───────────────────────────────┘
 *
 * Los paneles se montan una sola vez y en el teléfono se muestra el elegido:
 * el de WhatsApp sondea el estado del worker, y no tiene sentido tenerlo dos
 * veces. El panel abierto va en la URL (`?seccion=`), así el "atrás" del
 * teléfono vuelve a la lista.
 */
export function SettingsScreen({ groups }: { groups: SettingsGroup[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const sectionId = params.get("seccion");
  const items = groups.flatMap((g) => g.items);
  const selected = items.find((item) => item.id === sectionId) ?? null;

  /** ¿La entrada al panel la agregamos nosotros? Entonces "volver" es atrás. */
  const pushedRef = useRef(false);

  function open(id: string) {
    pushedRef.current = true;
    window.history.pushState(null, "", `${pathname}?seccion=${id}`);
  }

  function close() {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", pathname);
    }
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [sectionId]);

  return (
    <PhoneScreen
      scrollRef={scrollerRef}
      header={
        selected ? (
          <PhoneHeader
            leading={
              <button
                type="button"
                onClick={close}
                className="-ml-2 flex h-10 items-center gap-0.5 rounded-full pr-3 pl-1 text-[0.9375rem] font-medium text-[var(--wa-accent)] active:bg-[var(--wa-hover)]"
              >
                <ChevronLeft className="size-6" strokeWidth={2} />
                Configuración
              </button>
            }
            title={selected.title}
          />
        ) : (
          <PhoneHeader title="Configuración" />
        )
      }
    >
      <div className="max-w-3xl space-y-6 phone:space-y-0">
        <h1 className="text-2xl font-semibold tracking-tight phone:hidden">
          Configuración
        </h1>

        {/* ── La lista, sólo en el teléfono ─────────────────────────────── */}
        {selected ? null : (
          <div className="hidden phone:block phone:animate-in phone:fade-in phone:slide-in-from-left-8 phone:duration-200">
            {groups.map((group) => (
              <PhoneSection
                key={group.title}
                title={group.title}
                className="first:pt-2"
              >
                <PhoneGroup>
                  {group.items.map((item) => (
                    <PhoneRow
                      key={item.id}
                      onClick={() => open(item.id)}
                      leading={<ItemIcon icon={item.icon} />}
                      title={item.title}
                      subtitle={
                        item.status ? (
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                DOT[item.status.tone],
                              )}
                            />
                            <span className="truncate">
                              {item.status.label}
                              {item.detail ? ` · ${item.detail}` : ""}
                            </span>
                          </span>
                        ) : (
                          item.detail
                        )
                      }
                      chevron
                    />
                  ))}
                </PhoneGroup>
              </PhoneSection>
            ))}
          </div>
        )}

        {/* ── Los paneles: todos en el escritorio, el elegido en el teléfono ── */}
        {groups.map((group) => (
          <section
            key={group.title}
            className={cn(
              "space-y-3",
              !group.items.some((item) => item.id === selected?.id) &&
                "phone:hidden",
            )}
          >
            <h2 className="text-base font-semibold tracking-tight phone:hidden">
              {group.title}
            </h2>
            {group.items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  item.id === selected?.id
                    ? "phone:animate-in phone:px-4 phone:pt-1 phone:duration-200 phone:fade-in phone:slide-in-from-right-8"
                    : "phone:hidden",
                )}
              >
                {item.panel}
              </div>
            ))}
          </section>
        ))}
      </div>
    </PhoneScreen>
  );
}

function ItemIcon({ icon }: { icon: SettingsItem["icon"] }) {
  const { icon: Icon, tone } = ICONS[icon];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl",
        tone,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}
