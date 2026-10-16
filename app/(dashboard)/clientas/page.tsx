import { PhoneOrDesktop } from "@/components/dashboard/phone-screen";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewServiceButton } from "../servicios/service-dialog";
import { ServicesTable } from "../servicios/services-table";
import { NewClientButton } from "./client-dialog";
import { ClientsSearchBar } from "./search-bar";
import { ClientsTable } from "./clients-table";
import { PhoneClientas } from "./phone-clientas";
import { safeClientSort } from "./sort";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string; orden?: string }>;
};

/** Cuántas clientas trae la lista; más allá de eso, se busca. */
const CLIENTS_LIMIT = 200;

export default async function ClientasPage({ searchParams }: Props) {
  await requireRole(["owner", "receptionist"]);
  const { q = "", orden } = await searchParams;
  const query = q.trim();
  const sort = safeClientSort(orden);

  const supabase = await createClient();

  let clientsRequest = supabase.from("clients").select("*");
  if (sort === "recientes") {
    clientsRequest = clientsRequest.order("last_visit_at", {
      ascending: false,
      nullsFirst: false,
    });
  } else if (sort === "visitas") {
    clientsRequest = clientsRequest.order("total_visits", { ascending: false });
  } else if (sort === "gasto") {
    clientsRequest = clientsRequest.order("total_spent", { ascending: false });
  }
  clientsRequest = clientsRequest.order("full_name").limit(CLIENTS_LIMIT);

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

  const desktop = (
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

  // En el teléfono las tablas no entran: es la pantalla de contactos de
  // WhatsApp, con los mismos datos (ver ./phone-clientas).
  return (
    <PhoneOrDesktop
      phone={
        <PhoneClientas
          clients={clients ?? []}
          services={services ?? []}
          query={query}
          sort={sort}
          limit={CLIENTS_LIMIT}
        />
      }
      desktop={desktop}
    />
  );
}
