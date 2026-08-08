import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";
import { requireProfile } from "@/lib/auth";

/**
 * La raíz no tiene pantalla propia: manda a la herramienta principal según el
 * dispositivo. En el celular el uso real es contestar mensajes (la app se abre
 * desde la notificación de un WhatsApp), así que entra directo a la bandeja;
 * en escritorio se sigue trabajando desde la agenda.
 *
 * Las profesionales no tienen acceso al CRM: para ellas siempre es la agenda.
 */
export default async function DashboardHome() {
  const { profile } = await requireProfile();

  const { device } = userAgent({ headers: await headers() });
  const hasInbox = profile.role === "owner" || profile.role === "receptionist";

  if (device.type === "mobile" && hasInbox) redirect("/crm");
  redirect("/turnos");
}
