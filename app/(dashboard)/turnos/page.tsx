import { addDays, isValid, parseISO, startOfDay } from "date-fns";
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
 * Ventana de turnos que se carga: 2 semanas antes y 6 después de `anchor`.
 * Navegar día/semana adentro de ese rango no vuelve a pegarle al servidor.
 * Cuando la agenda se sale (ir a diciembre desde octubre) mueve `?fecha=` al
 * día visible y esta página trae la ventana nueva — ver
 * ./use-appointment-window.
 */
function appointmentWindow(anchor: Date) {
  const start = startOfDay(addDays(anchor, -WINDOW_DAYS_BACK));
  const end = startOfDay(addDays(anchor, WINDOW_DAYS_FORWARD));
  return { start, end };
}

/** `?fecha=2026-12-15` → ese día; cualquier otra cosa → hoy. */
function parseAnchor(value: string | string[] | undefined): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = parseISO(value);
    if (isValid(date)) return date;
  }
  return new Date();
}

export default async function TurnosPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string | string[] }>;
}) {
  await requireRole(["owner", "receptionist"]);
  const { fecha } = await searchParams;
  const supabase = await createClient();
  const { start, end } = appointmentWindow(parseAnchor(fecha));

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
      loadedWindow={{ start: start.toISOString(), end: end.toISOString() }}
    />
  );
}
