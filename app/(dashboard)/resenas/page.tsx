import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ResenasView } from "./resenas-view";
import type { ReviewRequestRow } from "./types";

export const dynamic = "force-dynamic";

/**
 * Cuántas encuestas se traen. Es una pantalla de trabajo pendiente, no un
 * archivo histórico: lo que importa está arriba de todo y el resto se lee
 * como contexto.
 */
const LIMIT = 200;

export default async function ResenasPage() {
  await requireRole(["owner", "receptionist"]);

  const supabase = await createClient();
  const { data } = await supabase
    .from("review_requests")
    .select(
      `
      id, asked_at, score, answered_at, feedback,
      case_status, case_notes, resolved_at, conversation_id,
      clients ( id, full_name, phone ),
      appointments (
        starts_at,
        professionals ( full_name ),
        appointment_services ( services ( name ) )
      ),
      automation_flows ( name )
    `,
    )
    .order("asked_at", { ascending: false })
    .limit(LIMIT);

  return <ResenasView requests={(data ?? []) as unknown as ReviewRequestRow[]} />;
}
