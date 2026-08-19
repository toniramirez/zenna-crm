import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb
  .from("whatsapp_sessions")
  .select("key, updated_at")
  .order("updated_at", { ascending: false })
  .limit(20);
console.log(error ?? data?.map(r => `${r.updated_at}  ${r.key.slice(0,70)}`).join("\n"));
