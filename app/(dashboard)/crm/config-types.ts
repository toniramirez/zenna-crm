import type { Database } from "@/types/database.types";

export type ClientTag = Database["public"]["Tables"]["client_tags"]["Row"];
export type QuickReply = Database["public"]["Tables"]["quick_replies"]["Row"];
export type AutomationFlow =
  Database["public"]["Tables"]["automation_flows"]["Row"];
export type PaymentMethod =
  Database["public"]["Tables"]["payment_methods"]["Row"];
export type ServiceSlim = {
  id: string;
  name: string;
  category: Database["public"]["Enums"]["service_category"];
};
