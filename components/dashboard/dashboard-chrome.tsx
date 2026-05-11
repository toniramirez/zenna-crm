"use client";

import type { ReactNode } from "react";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "./brand-wordmark";
import { useFocusMode } from "./focus-mode-context";
import { MobileSidebar } from "./mobile-sidebar";
import type { NavItem } from "./nav";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export function DashboardChrome({
  items,
  profile,
  email,
  children,
}: {
  items: NavItem[];
  profile: { full_name: string | null; role: AppRole };
  email: string;
  children: ReactNode;
}) {
  const { focused } = useFocusMode();

  return (
    <div
      className={cn(
        "grid h-screen w-full overflow-hidden transition-[grid-template-columns] duration-200",
        focused ? "md:grid-cols-[68px_1fr]" : "md:grid-cols-[260px_1fr]",
      )}
    >
      <aside className="surface-glass hidden md:flex text-sidebar-foreground">
        <div className="flex flex-col w-full">
          <div
            className={cn(
              "flex items-center justify-center relative",
              focused ? "px-2 py-5" : "px-4 py-8",
            )}
          >
            <span
              aria-hidden
              className="absolute bottom-0 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-[color:var(--gold)]/55 to-transparent"
            />
            {focused ? (
              <span
                className="font-display font-medium text-foreground text-2xl select-none"
                style={{ fontFeatureSettings: '"ss01"' }}
                title="ZENNA"
              >
                Z
              </span>
            ) : (
              <BrandWordmark size="lg" />
            )}
          </div>
          <div
            className={cn(
              "flex-1 overflow-y-auto py-4",
              focused ? "px-2" : "px-3",
            )}
          >
            <SidebarNav items={items} compact={focused} />
          </div>
          <div className="gold-hairline mx-3 opacity-50" />
          <div className="p-2">
            <UserMenu
              fullName={profile.full_name}
              email={email}
              role={profile.role}
              compact={focused}
            />
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-0">
        <header className="md:hidden relative flex h-14 shrink-0 items-center gap-2 surface-glass px-3">
          <span
            aria-hidden
            className="absolute bottom-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-[color:var(--gold)]/55 to-transparent"
          />
          <MobileSidebar items={items} />
          <div className="flex items-center gap-2 md:hidden">
            <BrandWordmark size="sm" />
          </div>
          <div className="ml-auto md:hidden">
            <UserMenu
              fullName={profile.full_name}
              email={email}
              role={profile.role}
            />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
