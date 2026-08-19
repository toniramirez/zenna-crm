import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: status, error } = await sb.from("whatsapp_status").select("*");
console.log("=== whatsapp_status ===");
console.log(error ?? status);

const now = new Date();
console.log("\nahora:", now.toISOString());

for (const ch of ["whatsapp", "whatsapp_cloud", "instagram"]) {
  const { data: last } = await sb
    .from("messages")
    .select("id, direction, sent_at, created_at, conversations!inner(channel)")
    .eq("conversations.channel", ch)
    .order("created_at", { ascending: false })
    .limit(3);
  console.log(`\n=== último mensaje ${ch} ===`);
  for (const m of last ?? []) console.log(`  ${m.direction} sent_at=${m.sent_at} created_at=${m.created_at}`);
}

const { data: lastIn } = await sb
  .from("messages")
  .select("sent_at, created_at, conversations!inner(channel, external_id)")
  .eq("conversations.channel", "whatsapp")
  .eq("direction", "inbound")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\n=== últimos ENTRANTES whatsapp (baileys) ===");
for (const m of lastIn ?? []) console.log(`  ${m.created_at} (sent ${m.sent_at})`);
