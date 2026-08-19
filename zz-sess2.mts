import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data } = await sb.from("whatsapp_sessions").select("key, updated_at");
const byType = new Map<string, { n: number; last: string }>();
for (const r of data ?? []) {
  const t = r.key.startsWith("keys.") ? r.key.split(".")[1] : r.key;
  const e = byType.get(t) ?? { n: 0, last: "" };
  e.n++;
  if ((r.updated_at as string) > e.last) e.last = r.updated_at as string;
  byType.set(t, e);
}
for (const [t, e] of [...byType].sort((a,b)=>b[1].n-a[1].n)) console.log(`${t.padEnd(24)} n=${String(e.n).padEnd(5)} last=${e.last}`);
