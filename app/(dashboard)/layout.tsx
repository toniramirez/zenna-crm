import type { ReactNode } from "react";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";
import { FocusModeProvider } from "@/components/dashboard/focus-mode-context";
import { NAV_ITEMS } from "@/components/dashboard/nav";
import { PushRouter } from "@/components/dashboard/push-router";
import { type AppRole, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * No leídos de toda la bandeja, para el globo verde de la pestaña Chats del
 * teléfono.
 *
 * Es la misma señal que hace que una abra WhatsApp, así que vale una consulta
 * por navegación: pide sólo la columna del contador, y sólo de las
 * conversaciones que tienen alguno. Si falla, es 0 — un globo de menos no
 * puede tirar abajo el layout entero.
 */
async function inboxUnreadCount(role: AppRole): Promise<number> {
  if (role !== "owner" && role !== "receptionist") return 0;

  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("unread_count")
    .eq("archived", false)
    .gt("unread_count", 0);

  return (data ?? []).reduce((total, row) => total + row.unread_count, 0);
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
