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
  /**
   * Nombre para la barra de pestañas del teléfono, donde cada ítem tiene
   * ~70px de ancho. Sin esto "Clientas y servicios" se corta en "Clientas
   * y…" y "Mensajes" no llega a evocar WhatsApp. Si falta, se usa `label`.
   */
  shortLabel?: string;
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
    shortLabel: "Clientas",
    iconName: "users",
    roles: ["owner", "receptionist"],
  },
  {
    href: "/crm",
    // La bandeja dejó de ser solo WhatsApp: también entran los DMs de Instagram.
    label: "Mensajes",
    shortLabel: "Chats",
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
    shortLabel: "Comisiones",
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

/**
 * Orden de la barra inferior del teléfono. La app en el celular es un chat:
 * "Chats" va al medio, que es donde llega el pulgar sin estirarse, y lo demás
 * se acomoda alrededor. Los ítems que no entran caen en la hoja "Más".
 *
 * Son hrefs y no ítems: el rol decide antes cuáles existen, así que esto es
 * sólo una preferencia de orden — lo que no está se saltea sin dejar hueco.
 */
export const MOBILE_TAB_ORDER = [
  "/turnos",
  "/caja",
  "/crm",
  "/clientas",
] as const;

/** Cuántos ítems entran en la barra antes de que aparezca "Más". */
export const MOBILE_TAB_SLOTS = 4;

export const ROLE_LABEL: Record<AppRole, string> = {
  owner: "Admin",
  receptionist: "Recepcionista",
  professional: "Profesional",
};
