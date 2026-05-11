import type { Database } from "@/types/database.types";

export type ConversationRow =
  Database["public"]["Tables"]["conversations"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export type ConversationWithClient = ConversationRow & {
  clients: {
    id: string;
    full_name: string;
    phone: string | null;
    tags: string[];
  } | null;
};
