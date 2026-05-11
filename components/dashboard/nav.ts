import {
  Building2,
  CalendarDays,
  type LucideIcon,
  MessageSquare,
  Scissors,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  UserSquare2,
  Wallet,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

// Icon registry. Storing icons as string keys (vs. component references)
// lets us pass NavItems across the Server → Client component boundary as
// plain objects. Server components cannot pass function/component references
// to client components in Next.js App Router.
const ICONS = {
  calendar: CalendarDays,
  users: Users,
  scissors: Scissors,
  professional: UserSquare2,
  trending: TrendingUp,
  message: MessageSquare,
  sparkles: Sparkles,
  settings: Settings,
  brand: Building2,
  wallet: Wallet,
} as const;

export type IconName = keyof typeof ICONS;

export function getIcon(name: IconName): LucideIcon {
  return ICONS[name];
}

export type NavItem = {
  href: string;
  label: string;
  iconName: IconName;
  roles: AppRole[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/turnos",
    label: "Turnos",
    iconName: "calendar",
    roles: ["owner", "receptionist", "professional"],
  },
  {
    href: "/caja",
    label: "Caja",
    iconName: "wallet",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/clientas",
    label: "Clientas y servicios",
    iconName: "users",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/profesionales",
    label: "Profesionales",
    iconName: "professional",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/finanzas",
    label: "Finanzas",
    iconName: "trending",
    roles: ["owner"],
  },
  {
    href: "/comisiones",
    label: "Mis comisiones",
    iconName: "trending",
    roles: ["professional"],
  },
  {
    href: "/crm",
    label: "CRM",
    iconName: "message",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/configuracion",
    label: "Configuración",
    iconName: "settings",
    roles: ["owner"],
  },
];

export const ROLE_LABEL: Record<AppRole, string> = {
  owner: "Admin",
  receptionist: "Recepcionista",
  professional: "Profesional",
};
