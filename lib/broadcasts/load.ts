import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BroadcastStats,
  BroadcastStatsRow,
  BroadcastWithStats,
} from "./types";
import type { Database } from "@/types/database.types";

/** Cuántas difusiones muestra el panel. Las viejas siguen en la base. */
export const BROADCAST_LIST_LIMIT = 50;

export const EMPTY_BROADCAST_STATS: BroadcastStats = {
  total: 0,
  pending: 0,
  skipped: 0,
  failed: 0,
  inQueue: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  replied: 0,
};

function statsOf(row: BroadcastStatsRow | undefined): BroadcastStats {
  if (!row) return EMPTY_BROADCAST_STATS;
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    skipped: row.skipped ?? 0,
    failed: row.failed ?? 0,
    inQueue: row.in_queue ?? 0,
    sent: row.sent ?? 0,
    delivered: row.delivered ?? 0,
    read: row.read ?? 0,
    replied: row.replied ?? 0,
  };
}

/**
 * Las difusiones del panel con sus números. Lo usan la página (carga
 * inicial) y la server action que el panel sondea mientras hay una saliendo,
 * así las dos dicen exactamente lo mismo.
 */
export async function loadBroadcastsWithStats(
  supabase: SupabaseClient<Database>,
): Promise<BroadcastWithStats[]> {
  const { data: broadcasts, error } = await supabase
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(BROADCAST_LIST_LIMIT);

  if (error) {
    // La tabla todavía no existe (no se corrió scripts/sql/broadcasts.sql):
    // el panel muestra la lista vacía en vez de romper toda la página /crm.
    console.error("[broadcasts] list error:", error.message);
    return [];
  }
  if (!broadcasts || broadcasts.length === 0) return [];

  const { data: stats } = await supabase
    .from("broadcast_stats")
    .select("*")
    .in(
      "broadcast_id",
      broadcasts.map((b) => b.id),
    );

  const byId = new Map(
    (stats ?? []).map((s) => [s.broadcast_id ?? "", s] as const),
  );

  return broadcasts.map((b) => ({ ...b, stats: statsOf(byId.get(b.id)) }));
}
