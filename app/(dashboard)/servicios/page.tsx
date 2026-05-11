import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewServiceButton } from "./service-dialog";
import { ServicesTable } from "./services-table";

export const dynamic = "force-dynamic";

export default async function ServiciosPage() {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { data: services } = await supabase
    .from("services")
    .select("*")
    .order("active", { ascending: false })
    .order("category")
    .order("name");

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Servicios</h1>
        <NewServiceButton />
      </div>

      <ServicesTable services={services ?? []} />
    </div>
  );
}
