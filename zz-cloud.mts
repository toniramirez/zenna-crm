import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb.from("whatsapp_cloud_accounts").select("*");
if (error) console.log(error);
for (const a of data ?? []) {
  const { access_token, ...rest } = a as any;
  console.log({ ...rest, has_token: !!access_token });
}
