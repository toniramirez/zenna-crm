import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewProfessionalButton } from "./professional-dialog";
import { ProfessionalsTable } from "./professionals-table";

export const dynamic = "force-dynamic";

export default async function ProfesionalesPage() {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { data: professionals } = await supabase
    .from("professionals")
    .select("*")
    .order("active", { ascending: false })
    .order("full_name");

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">
          Profesionales
        </h1>
        <NewProfessionalButton />
      </div>

      <ProfessionalsTable professionals={professionals ?? []} />
    </div>
  );
}
