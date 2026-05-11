import { TrendingUp } from "lucide-react";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";
import { requireRole } from "@/lib/auth";

export default async function ComisionesPage() {
  await requireRole("professional");
  return (
    <PlaceholderPage
      title="Mis comisiones"
      description="Detalle de comisiones acumuladas — Fase 2."
      icon={TrendingUp}
      body="Vas a ver tus comisiones generadas por servicio, separadas por mes, con el estado pendiente o pagado."
    />
  );
}
