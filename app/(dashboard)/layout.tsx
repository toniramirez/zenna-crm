import type { ReactNode } from "react";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";
import { FocusModeProvider } from "@/components/dashboard/focus-mode-context";
import { NAV_ITEMS } from "@/components/dashboard/nav";
import { PushRouter } from "@/components/dashboard/push-router";
import { type AppRole, requireProfile } from "@/lib/auth";
import { countInboxUnread } from "@/lib/inbox-unread";
import { createClient } from "@/lib/supabase/server";

/**
 * Chats sin leer de la bandeja, para el globo verde de la pestaña Chats del
 * teléfono y del rail del escritorio.
 *
 * Es la misma señal que hace que una abra WhatsApp, así que vale una consulta
 * por navegación. Si falla, es 0 — un globo de menos no puede tirar abajo el
 * layout entero.
 */
async function inboxUnreadCount(role: AppRole): Promise<number> {
  if (role !== "owner" && role !== "receptionist") return 0;

  const supabase = await createClient();
  return countInboxUnread(supabase);
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { profile, email } = await requireProfile();

  const items = NAV_ITEMS.filter((item) => item.roles.includes(profile.role));
  const unreadCount = await inboxUnreadCount(profile.role);

  return (
    <FocusModeProvider>
      <PushRouter />
      <DashboardChrome
        items={items}
        profile={profile}
        email={email}
        unreadCount={unreadCount}
      >
        {children}
      </DashboardChrome>
    </FocusModeProvider>
  );
}
