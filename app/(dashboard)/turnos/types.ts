import type { Database } from "@/types/database.types";

export type AppointmentRow =
  Database["public"]["Tables"]["appointments"]["Row"];
export type AppointmentServiceRow =
  Database["public"]["Tables"]["appointment_services"]["Row"];
export type ServiceRow = Database["public"]["Tables"]["services"]["Row"];
export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type ProfessionalRow =
  Database["public"]["Tables"]["professionals"]["Row"];

/**
 * Compact shape for a calendar event: appointment with embedded
 * service line items and the basic client info we render on the card.
 */
export type AppointmentWithRelations = AppointmentRow & {
  appointment_services: (AppointmentServiceRow & {
    services: Pick<ServiceRow, "id" | "name" | "category"> | null;
  })[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone"> | null;
};
