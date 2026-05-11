import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  BufferJSON,
  initAuthCreds,
} from "@whiskeysockets/baileys";
import type { Database, Json } from "@/types/database.types";

/**
 * Baileys auth state adapter backed by Supabase. The KV-style table
 * `whatsapp_sessions` stores one row per (session, key). Buffer values
 * are passed through BufferJSON so they survive the round-trip to JSONB.
 */

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as Json;
}

function fromJson<T = unknown>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

export async function useSupabaseAuthState(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Load creds (or initialise fresh ones for first connection)
  const { data: credsRow } = await supabase
    .from("whatsapp_sessions")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", "creds")
    .maybeSingle();

  const creds: AuthenticationCreds = credsRow
    ? fromJson<AuthenticationCreds>(credsRow.value)
    : initAuthCreds();

  const saveCreds = async () => {
    await supabase
      .from("whatsapp_sessions")
      .upsert(
        { session_id: sessionId, key: "creds", value: toJson(creds) },
        { onConflict: "session_id,key" },
      );
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ) => {
          const out: { [_: string]: SignalDataTypeMap[T] } = {};
          if (ids.length === 0) return out;
          const dbKeys = ids.map((id) => `keys.${type}.${id}`);
          const { data } = await supabase
            .from("whatsapp_sessions")
            .select("key, value")
            .eq("session_id", sessionId)
            .in("key", dbKeys);
          for (const row of data ?? []) {
            const id = row.key.split(".").slice(2).join(".");
            out[id] = fromJson<SignalDataTypeMap[T]>(row.value);
          }
          return out;
        },
        set: async (data) => {
          const rows: { session_id: string; key: string; value: Json }[] = [];
          const toDelete: string[] = [];
          for (const type in data) {
            const items = data[type as keyof SignalDataTypeMap];
            if (!items) continue;
            for (const id in items) {
              const value = (items as Record<string, unknown>)[id];
              const key = `keys.${type}.${id}`;
              if (value) {
                rows.push({
                  session_id: sessionId,
                  key,
                  value: toJson(value),
                });
              } else {
                toDelete.push(key);
              }
            }
          }
          if (rows.length) {
            const { error } = await supabase
              .from("whatsapp_sessions")
              .upsert(rows, { onConflict: "session_id,key" });
            if (error) console.error("[supabase-auth] upsert error:", error);
          }
          if (toDelete.length) {
            await supabase
              .from("whatsapp_sessions")
              .delete()
              .eq("session_id", sessionId)
              .in("key", toDelete);
          }
        },
      },
    },
    saveCreds,
  };
}
