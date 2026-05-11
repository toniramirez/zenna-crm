import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewClientButton } from "./client-dialog";
import { ClientsSearchBar } from "./search-bar";
import { ClientsTable } from "./clients-table";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function ClientasPage({ searchParams }: Props) {
  await requireRole(["owner", "receptionist"]);
  const { q = "" } = await searchParams;
  const query = q.trim();

  const supabase = await createClient();
  let request = supabase
    .from("clients")
    .select("*")
    .order("full_name")
    .limit(200);

  if (query) {
    // Match name OR phone using ILIKE for case-insensitive partial matches.
    // The DB has trigram GIN indexes on both columns so this stays fast at scale.
    const escaped = query.replace(/[%_]/g, "\\$&");
    request = request.or(
      `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`,
    );
  }

  const { data: clients } = await request;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Clientas</h1>
        <NewClientButton />
      </div>

      <ClientsSearchBar initial={query} />

      <ClientsTable clients={clients ?? []} query={query} />
    </div>
  );
}
