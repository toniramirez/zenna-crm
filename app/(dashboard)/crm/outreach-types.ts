import type { Database } from "@/types/database.types";

export type OutreachSuggestionRow =
  Database["public"]["Tables"]["outreach_suggestions"]["Row"];

export type OutreachSuggestionStatus = "pending" | "sent" | "dismissed";

/**
 * Row + the bits of related data the inbox UI needs to render a card
 * (client name/phone + suggested service label). The joined-in fields are
 * snapshots at fetch time; if a client is deleted the suggestion cascades
 * but a service is just nulled (FK on delete set null).
 */
export type OutreachSuggestionWithRelations = OutreachSuggestionRow & {
  clients: {
    id: string;
    full_name: string;
    phone: string | null;
    last_visit_at: string | null;
  } | null;
  services: {
    id: string;
    name: string;
  } | null;
};
