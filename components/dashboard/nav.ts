import {
  BarChart3,
  CalendarDays,
  ContactRound,
  CreditCard,
  GraduationCap,
  LayoutGrid,
  type LucideIcon,
  MessageCircle,
  Scissors,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

// Icon registry. Storing icons as string keys (vs. component references)
// lets us pass NavItems across the Server → Client component boundary as
// plain objects. Server components cannot pass function/component references
// to client components in Next.js App Router.
const ICONS = {
  home: LayoutGrid,
  calendar: CalendarDays,
  users: Users,
  chat: MessageCircle,
  scissors: Scissors,
  wallet: CreditCard,
  professional: ContactRound,
  trending: BarChart3,
  academy: GraduationCap,
  sparkles: Sparkles,
  settings: Settings,
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

/**
 * Orden del rail, calcado del referente: agenda → gente → chat → plata →
 * configuración. Los íconos son de trazo fino y todos del mismo peso visual,
 * porque el rail no tiene etiquetas: la silueta es lo único que distingue.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/turnos",
    label: "Turnos",
    iconName: "calendar",
    roles: ["owner", "receptionist", "professional"],
  },
  {
    href: "/clientas",
    label: "Clientas y servicios",
    iconName: "users",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/crm",
    // La bandeja dejó de ser solo WhatsApp: también entran los DMs de Instagram.
    label: "Mensajes",
    iconName: "chat",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/caja",
    label: "Caja",
    iconName: "wallet",
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
