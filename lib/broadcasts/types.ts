import type { Database } from "@/types/database.types";

export type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];
export type BroadcastStatsRow =
  Database["public"]["Views"]["broadcast_stats"]["Row"];
export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "cancelled";

/** Los números de una difusión, ya sin los null de la vista. */
export type BroadcastStats = {
  total: number;
  pending: number;
  skipped: number;
  failed: number;
  inQueue: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
};

export type BroadcastWithStats = BroadcastRow & { stats: BroadcastStats };

/** Lo mínimo de una profesional que necesita el filtro de difusiones. */
export type ProfessionalSlim = { id: string; full_name: string };

export type BroadcastRecipientView = {
  id: string;
  fullName: string;
  phone: string;
  status: string;
  error: string | null;
  conversationId: string | null;
  processedAt: string | null;
  /** Estado del mensaje encolado (sent, delivered, read, failed…). */
  messageStatus: string | null;
  messageError: string | null;
};
