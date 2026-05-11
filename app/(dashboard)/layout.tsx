import type { ReactNode } from "react";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";
import { FocusModeProvider } from "@/components/dashboard/focus-mode-context";
import { NAV_ITEMS } from "@/components/dashboard/nav";
import { requireProfile } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { profile, email } = await requireProfile();

  const items = NAV_ITEMS.filter((item) => item.roles.includes(profile.role));

  return (
    <FocusModeProvider>
      <DashboardChrome items={items} profile={profile} email={email}>
        {children}
      </DashboardChrome>
    </FocusModeProvider>
  );
}
