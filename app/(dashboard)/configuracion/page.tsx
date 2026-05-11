import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WhatsappPanel } from "./whatsapp-panel";
import type { Database } from "@/types/database.types";

export const dynamic = "force-dynamic";

type Status = Database["public"]["Tables"]["whatsapp_status"]["Row"];

export default async function ConfiguracionPage() {
  await requireRole("owner");

  const supabase = await createClient();
  const { data: status } = await supabase
    .from("whatsapp_status")
    .select("*")
    .eq("session_id", "default")
    .maybeSingle();

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Integraciones</h2>
        <WhatsappPanel initialStatus={(status as Status | null) ?? null} />
      </section>
    </div>
  );
}
