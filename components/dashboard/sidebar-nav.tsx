"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getIcon, type NavItem } from "./nav";

/**
 * Navegación del rail. En modo `compact` (el default del escritorio) son
 * pastillas cuadradas de 36px sin etiqueta — igual que el referente. Al
 * expandir, la misma pastilla se estira y muestra el texto al costado.
 */
export function SidebarNav({
  items,
  onNavigate,
  compact = false,
  badges,
}: {
  items: NavItem[];
  onNavigate?: () => void;
  compact?: boolean;
  /** Contadores por href. Hoy sólo los mensajes sin leer de la bandeja. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1", compact && "items-center")}>
      {items.map((item) => {
        const Icon = getIcon(item.iconName);
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = badges?.[item.href] ?? 0;
        const label =
          badge > 0
            ? `${item.label}, ${badge} sin leer`
            : item.label;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-active={active}
            className={cn("rail-item", !compact && "rail-item-wide")}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            {compact ? (
              <span className="sr-only">{label}</span>
            ) : (
              <span className="text-sm font-medium truncate">{item.label}</span>
            )}
            {/*
              Globo de no leídos. Con el rail contraído se monta encima del
              ícono —es la única forma de que se vea en 36px—; expandido va al
              final de la fila, donde no le compite al texto.
            */}
            {badge > 0 ? (
              compact ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-semibold tabular-nums text-primary-foreground ring-2 ring-sidebar"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="ml-auto inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold tabular-nums text-primary-foreground"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
