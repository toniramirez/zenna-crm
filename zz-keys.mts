import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data } = await sb.from("whatsapp_sessions").select("key, updated_at");
const pre = (data ?? []).filter(r => r.key.startsWith("keys.pre-key."))
  .map(r => ({ id: Number(r.key.split(".")[2]), at: r.updated_at as string }))
  .sort((a,b)=>a.id-b.id);
console.log("pre-keys:", pre.length, "min:", pre[0]?.id, "max:", pre.at(-1)?.id);
const byTs = new Map<string, number[]>();
for (const p of pre) byTs.set(p.at, [...(byTs.get(p.at) ?? []), p.id]);
for (const [ts, ids] of [...byTs].sort()) console.log(`  ${ts}  ids ${Math.min(...ids)}-${Math.max(...ids)} (${ids.length})`);
const sess = (data ?? []).filter(r => r.key.startsWith("keys.session."));
const sessBy = new Map<string, number>();
for (const s of sess) sessBy.set((s.updated_at as string).slice(0,16), (sessBy.get((s.updated_at as string).slice(0,16)) ?? 0) + 1);
console.log("\nsessions por minuto:");
for (const [ts, n] of [...sessBy].sort()) console.log(`  ${ts} ${n}`);
