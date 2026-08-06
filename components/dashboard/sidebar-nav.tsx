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
}: {
  items: NavItem[];
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1", compact && "items-center")}>
      {items.map((item) => {
        const Icon = getIcon(item.iconName);
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={item.label}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            data-active={active}
            className={cn("rail-item", !compact && "rail-item-wide")}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            {compact ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span className="text-sm font-medium truncate">{item.label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
