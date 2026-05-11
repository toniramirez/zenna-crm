"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { OpenAIError } from "@/lib/openai/client";
import {
  generateOutreachSuggestions,
  type OutreachCandidate,
  type ServiceOption,
} from "@/lib/openai/outreach";
import { createClient } from "@/lib/supabase/server";

export type OutreachActionState = {
  error?: string;
  success?: boolean;
  /** When generation succeeds, how many new suggestions were inserted. */
  inserted?: number;
};

/**
 * Window of inactivity that makes a client a candidate for re-engagement.
 * Tunable — 21 days is a "you didn't come this month either" signal without
 * being too aggressive.
 */
const DORMANT_AFTER_DAYS = 21;

/**
 * After we generate a suggestion for a client (whether sent or pending), we
 * leave them alone for this many days. Prevents spamming the same person
 * across multiple generation runs.
 */
const COOLDOWN_DAYS_AFTER_SENT = 60;
const COOLDOWN_DAYS_AFTER_DISMISSED = 30;

/** Hard cap on how many suggestions GPT can produce in a single run. */
const MAX_PER_RUN = 8;

/** How many candidates to feed GPT — the model picks the best subset. */
const CANDIDATE_POOL_SIZE = 25;

export async function generateOutreachSuggestionsAction(): Promise<OutreachActionState> {
  await requireRole("owner");
  const supabase = await createClient();

  // 1. Active services catalog (GPT picks from this list).
  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, category, price")
    .eq("active", true);
  if (servicesError || !services || services.length === 0) {
    return {
      error: "No hay servicios activos cargados para sugerir.",
    };
  }

  // 2. Candidate pool: clients with a conversation, with phone, dormant
  //    long enough, and not currently in cooldown from a previous suggestion.
  //    Done as raw SQL via rpc-less pattern — Supabase JS doesn't compose
  //    NOT EXISTS clauses, so we filter in two passes.
  const dormantThreshold = new Date(
    Date.now() - DORMANT_AFTER_DAYS * 86400 * 1000,
  ).toISOString();

  const { data: rawCandidates, error: clientsError } = await supabase
    .from("clients")
    .select(
      "id, full_name, phone, last_visit_at, total_visits, hair_notes, conversations!inner(id)",
    )
    .not("phone", "is", null)
    .not("last_visit_at", "is", null)
    .lt("last_visit_at", dormantThreshold)
    .order("last_visit_at", { ascending: false })
    .limit(CANDIDATE_POOL_SIZE * 3); // overshoot — we'll filter by cooldown next

  if (clientsError) {
    return { error: "No pudimos leer las clientas candidatas." };
  }
  if (!rawCandidates || rawCandidates.length === 0) {
    return { error: "No hay clientas que cumplan los criterios de outreach." };
  }

  // 3. Cooldown filter: pull all suggestions for these clients in the last
  //    COOLDOWN_DAYS_AFTER_SENT days, then filter in memory. Doing it in JS
  //    keeps the query simple and avoids URL-encoding edge cases with the
  //    composite .or() PostgREST filter.
  const sentCutoff = Date.now() - COOLDOWN_DAYS_AFTER_SENT * 86400 * 1000;
  const dismissedCutoff =
    Date.now() - COOLDOWN_DAYS_AFTER_DISMISSED * 86400 * 1000;

  const candidateIds = rawCandidates.map((c) => c.id);
  const { data: priorSuggestions, error: blockedError } = await supabase
    .from("outreach_suggestions")
    .select("client_id, status, sent_at, dismissed_at")
    .in("client_id", candidateIds)
    .gte(
      "generated_at",
      new Date(sentCutoff).toISOString(),
    );
  if (blockedError) {
    return { error: "No pudimos verificar el cooldown de outreach." };
  }

  const blockedIds = new Set<string>();
  for (const row of priorSuggestions ?? []) {
    if (row.status === "pending") {
      blockedIds.add(row.client_id);
    } else if (
      row.status === "sent" &&
      row.sent_at &&
      new Date(row.sent_at).getTime() >= sentCutoff
    ) {
      blockedIds.add(row.client_id);
    } else if (
      row.status === "dismissed" &&
      row.dismissed_at &&
      new Date(row.dismissed_at).getTime() >= dismissedCutoff
    ) {
      blockedIds.add(row.client_id);
    }
  }

  const eligible = rawCandidates
    .filter((c) => !blockedIds.has(c.id))
    .slice(0, CANDIDATE_POOL_SIZE);

  if (eligible.length === 0) {
    return {
      error:
        "Todas las clientas candidatas están en cooldown. Volvé a intentar más adelante.",
    };
  }

  // 4. Pull each candidate's service history (last 6 months of completed
  //    appointments). One query, group in memory.
  const sixMonthsAgo = new Date(
    Date.now() - 180 * 86400 * 1000,
  ).toISOString();
  const { data: historyRows, error: historyError } = await supabase
    .from("appointments")
    .select(
      "client_id, starts_at, appointment_services(services(name, category))",
    )
    .in(
      "client_id",
      eligible.map((c) => c.id),
    )
    .eq("status", "completed")
    .gte("starts_at", sixMonthsAgo);
  if (historyError) {
    return { error: "No pudimos leer el historial de servicios." };
  }

  type HistoryAgg = Map<
    string,
    Map<string, { serviceName: string; category: string; times: number }>
  >;
  const historyByClient: HistoryAgg = new Map();
  for (const row of historyRows ?? []) {
    const clientId = row.client_id;
    const services = row.appointment_services ?? [];
    let bucket = historyByClient.get(clientId);
    if (!bucket) {
      bucket = new Map();
      historyByClient.set(clientId, bucket);
    }
    for (const apsvc of services) {
      const svc = apsvc.services;
      if (!svc) continue;
      const key = svc.name;
      const existing = bucket.get(key);
      if (existing) {
        existing.times += 1;
      } else {
        bucket.set(key, {
          serviceName: svc.name,
          category: svc.category,
          times: 1,
        });
      }
    }
  }

  const now = Date.now();
  const candidates: OutreachCandidate[] = eligible.map((c) => {
    const days =
      c.last_visit_at !== null
        ? Math.floor((now - new Date(c.last_visit_at).getTime()) / 86400000)
        : null;
    const history = Array.from(historyByClient.get(c.id)?.values() ?? []);
    history.sort((a, b) => b.times - a.times);
    return {
      clientId: c.id,
      fullName: c.full_name,
      firstName: c.full_name.split(" ")[0] ?? c.full_name,
      lastVisitAt: c.last_visit_at,
      daysSinceLastVisit: days,
      totalVisits: c.total_visits,
      hairNotes: c.hair_notes,
      history,
    };
  });

  const serviceOptions: ServiceOption[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    price: s.price,
  }));

  // 5. Call GPT.
  let result: Awaited<ReturnType<typeof generateOutreachSuggestions>>;
  try {
    result = await generateOutreachSuggestions({
      candidates,
      services: serviceOptions,
      limit: MAX_PER_RUN,
    });
  } catch (err) {
    if (err instanceof OpenAIError) {
      return { error: err.message };
    }
    return { error: "No pudimos generar sugerencias (error de red o IA)." };
  }

  if (result.suggestions.length === 0) {
    return {
      error:
        "La IA no devolvió sugerencias útiles. Probá de nuevo en un rato.",
    };
  }

  // 6. Insert into DB.
  const rows = result.suggestions.map((s) => ({
    client_id: s.clientId,
    service_id: s.serviceId,
    reason: s.reason,
    message_body: s.messageBody,
    generated_by: result.model,
  }));
  const { error: insertError } = await supabase
    .from("outreach_suggestions")
    .insert(rows);
  if (insertError) {
    return { error: "No pudimos guardar las sugerencias generadas." };
  }

  revalidatePath("/crm");
  return { success: true, inserted: rows.length };
}

export async function markSuggestionSentAction(
  id: string,
): Promise<OutreachActionState> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_suggestions")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: "No pudimos marcar la sugerencia como enviada." };
  revalidatePath("/crm");
  return { success: true };
}

export async function dismissSuggestionAction(
  id: string,
): Promise<OutreachActionState> {
  await requireRole(["owner", "receptionist"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_suggestions")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: "No pudimos descartar la sugerencia." };
  revalidatePath("/crm");
  return { success: true };
}

export async function updateSuggestionMessageAction(
  id: string,
  messageBody: string,
): Promise<OutreachActionState> {
  await requireRole(["owner", "receptionist"]);
  const trimmed = messageBody.trim();
  if (trimmed.length < 5) {
    return { error: "El mensaje es muy corto." };
  }
  if (trimmed.length > 4000) {
    return { error: "El mensaje es demasiado largo." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_suggestions")
    .update({ message_body: trimmed })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: "No pudimos guardar el mensaje." };
  revalidatePath("/crm");
  return { success: true };
}
