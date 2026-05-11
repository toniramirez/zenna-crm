import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewServiceButton } from "../servicios/service-dialog";
import { ServicesTable } from "../servicios/services-table";
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

  let clientsRequest = supabase
    .from("clients")
    .select("*")
    .order("full_name")
    .limit(200);

  if (query) {
    // Match name OR phone using ILIKE for case-insensitive partial matches.
    // The DB has trigram GIN indexes on both columns so this stays fast at scale.
    const escaped = query.replace(/[%_]/g, "\\$&");
    clientsRequest = clientsRequest.or(
      `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`,
    );
  }

  const [{ data: clients }, { data: services }] = await Promise.all([
    clientsRequest,
    supabase
      .from("services")
      .select("*")
      .order("active", { ascending: false })
      .order("category")
      .order("name"),
  ]);

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Clientas y servicios
      </h1>

      <Tabs defaultValue="clientas" className="gap-6">
        <TabsList>
          <TabsTrigger value="clientas">Clientas</TabsTrigger>
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
        </TabsList>

        <TabsContent value="clientas" className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <ClientsSearchBar initial={query} />
            <NewClientButton />
          </div>
          <ClientsTable clients={clients ?? []} query={query} />
        </TabsContent>

        <TabsContent value="servicios" className="space-y-6">
          <div className="flex items-center justify-end gap-4 flex-wrap">
            <NewServiceButton />
          </div>
          <ServicesTable services={services ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
