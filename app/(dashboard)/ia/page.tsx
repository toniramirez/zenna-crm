import { Sparkles } from "lucide-react";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";
import { requireRole } from "@/lib/auth";

export default async function IaPage() {
  await requireRole(["owner", "receptionist"]);
  return (
    <PlaceholderPage
      title="IA"
      description="Generador de presupuestos en PDF y recordatorios inteligentes — Fase 4."
      icon={Sparkles}
      body="Describís un combo en lenguaje natural y GPT te genera un presupuesto profesional en PDF con logo, ítems, totales y validez, listo para mandar por WhatsApp."
    />
  );
}
