"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getIcon, type NavItem } from "./nav";

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
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = getIcon(item.iconName);
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            aria-label={compact ? item.label : undefined}
            className={cn(
              "relative flex items-center rounded-md text-sm font-medium transition-colors",
              compact
                ? "justify-center px-2 py-2"
                : "gap-3 px-3 py-2",
              active
                ? "sidebar-nav-active bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {compact ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span>{item.label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
