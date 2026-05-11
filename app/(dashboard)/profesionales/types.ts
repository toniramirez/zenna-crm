import type { Database } from "@/types/database.types";

export type ProfessionalRow =
  Database["public"]["Tables"]["professionals"]["Row"];
export type ScheduleRow =
  Database["public"]["Tables"]["professional_schedules"]["Row"];
export type TimeOffRow =
  Database["public"]["Tables"]["professional_time_off"]["Row"];
