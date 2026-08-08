import { addDays, startOfDay } from "date-fns";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  WINDOW_DAYS_BACK,
  WINDOW_DAYS_FORWARD,
} from "./appointment-utils";
import { CalendarView } from "./calendar-view";
import type { AppointmentWithRelations } from "./types";

export const dynamic = "force-dynamic";

/**
 * Window of appointments to load. We pre-load a generous range so navigating
 * day/week within FullCalendar doesn't require a re-fetch. Anything outside
 * this window simply won't render until the user reloads.
 *
 * 2 weeks back + 6 weeks forward = ~8 weeks of context.
 */
function appointmentWindow(now: Date) {
  const start = startOfDay(addDays(now, -WINDOW_DAYS_BACK));
  const end = startOfDay(addDays(now, WINDOW_DAYS_FORWARD));
  return { start, end };
}

export default async function TurnosPage() {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { start, end } = appointmentWindow(new Date());

  const [
    professionalsResult,
    servicesResult,
    clientsResult,
    appointmentsResult,
  ] = await Promise.all([
    supabase
      .from("professionals")
      .select("*")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("services")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name"),
    supabase
      .from("clients")
      .select("id, full_name, phone")
      .order("full_name")
      .limit(500),
    supabase
      .from("appointments")
      .select(
        "*, appointment_services(*, services(id, name, category)), clients(id, full_name, phone)",
      )
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at"),
  ]);

  const professionals = professionalsResult.data ?? [];
  const services = servicesResult.data ?? [];
  const clients = clientsResult.data ?? [];
  const appointments =
    (appointmentsResult.data as AppointmentWithRelations[] | null) ?? [];

  // Sin <h1>: la agenda va a sangre y su propio toolbar hace de encabezado,
  // igual que en el diseño de referencia.
  return (
    <CalendarView
      professionals={professionals}
      services={services}
      clients={clients}
      appointments={appointments}
    />
  );
}
