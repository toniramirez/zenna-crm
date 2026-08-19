import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// mensajes de baileys por hora, hoy
const since = "2026-08-19T00:00:00Z";
const { data } = await sb
  .from("messages")
  .select("direction, status, created_at, conversations!inner(channel)")
  .eq("conversations.channel", "whatsapp")
  .gte("created_at", since)
  .order("created_at");
const buckets = new Map<string, { in: number; out: number }>();
for (const m of data ?? []) {
  const h = (m.created_at as string).slice(11, 13) + "h";
  const b = buckets.get(h) ?? { in: 0, out: 0 };
  if (m.direction === "inbound") b.in++; else b.out++;
  buckets.set(h, b);
}
console.log("=== baileys por hora (UTC) hoy ===");
for (const [h, b] of buckets) console.log(`  ${h}  in=${b.in}  out=${b.out}`);

// cola de salida pendiente
const { data: pend } = await sb
  .from("messages")
  .select("id, status, created_at, sent_at, body, conversations!inner(channel, external_id)")
  .eq("conversations.channel", "whatsapp")
  .in("status", ["queued", "pending", "sending", "failed"])
  .order("created_at", { ascending: false })
  .limit(15);
console.log(`\n=== cola de salida whatsapp (no enviados) === ${pend?.length ?? 0}`);
for (const m of pend ?? []) console.log(`  ${m.created_at?.slice(11,19)} ${m.status} ${(m.body ?? "").slice(0,40)}`);

// estados posibles en la tabla
const { data: statuses } = await sb.from("messages").select("status").limit(1000).order("created_at", { ascending: false });
console.log("\nestados vistos:", [...new Set((statuses ?? []).map(s => s.status))]);
