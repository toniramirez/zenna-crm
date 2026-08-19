import { config } from "dotenv";
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb.from("whatsapp_sessions").select("*").eq("key","creds").maybeSingle();
if (error) console.log(error);
const v = (data as any)?.value ?? {};
console.log("updated_at:", (data as any)?.updated_at);
console.log("claves de creds:", Object.keys(v).join(", "));
console.log({
  registered: v.registered,
  me: v.me,
  platform: v.platform,
  nextPreKeyId: v.nextPreKeyId,
  firstUnuploadedPreKeyId: v.firstUnuploadedPreKeyId,
  accountSyncCounter: v.accountSyncCounter,
  lastAccountSyncTimestamp: v.lastAccountSyncTimestamp,
  myAppStateKeyId: v.myAppStateKeyId,
  processedHistoryMessages: Array.isArray(v.processedHistoryMessages) ? v.processedHistoryMessages.length : v.processedHistoryMessages,
  lastPropHash: v.lastPropHash,
  routingInfo: !!v.routingInfo,
  signalIdentities: Array.isArray(v.signalIdentities) ? v.signalIdentities.length : v.signalIdentities,
});
console.log("tamaño JSON:", JSON.stringify(data?.value).length, "bytes");
