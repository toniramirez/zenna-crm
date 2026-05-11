"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applySurcharge, budgetSchema } from "@/lib/validations/budgets";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

export type CreateBudgetResult = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
  budgetId?: string;
};

/**
 * Persist a budget generated from the chat. We store everything as a
 * snapshot (client name, service names, payment-method labels, surcharge
 * percentages and pre-computed totals) so the historical record stays
 * stable even when the underlying clients/services/payment_methods get
 * renamed or archived later.
 *
 * Note: the PDF is rendered on the client (jsPDF). This action just
 * writes the canonical record to the DB and returns its id, leaving the
 * caller to generate + download the file using the same numbers.
 */
export async function createBudgetAction(
  input: unknown,
): Promise<CreateBudgetResult> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const data = parsed.data;

  const totalMin = data.items.reduce((acc, i) => acc + i.priceMin, 0);
  const totalMax = data.items.reduce((acc, i) => acc + i.priceMax, 0);

  const supabase = await createClient();

  const { data: budget, error: budgetErr } = await supabase
    .from("budgets")
    .insert({
      conversation_id: data.conversationId,
      client_id: data.clientId,
      client_name_snapshot: data.clientName.trim(),
      client_phone_snapshot: data.clientPhone?.trim() || null,
      notes: data.notes?.trim() || null,
      total_min: totalMin,
      total_max: totalMax,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (budgetErr || !budget) {
    console.error("[crm] createBudget header error:", budgetErr);
    return { error: "No pudimos guardar el presupuesto." };
  }

  const itemsPayload = data.items.map((item, index) => ({
    budget_id: budget.id,
    service_id: item.serviceId,
    service_name_snapshot: item.serviceName.trim(),
    price_min: item.priceMin,
    price_max: item.priceMax,
    sort_order: index,
  }));
  const { error: itemsErr } = await supabase
    .from("budget_items")
    .insert(itemsPayload);
  if (itemsErr) {
    // Best-effort cleanup so we don't leave an orphan header.
    await supabase.from("budgets").delete().eq("id", budget.id);
    console.error("[crm] createBudget items error:", itemsErr);
    return { error: "No pudimos guardar los servicios del presupuesto." };
  }

  const optionsPayload = data.paymentOptions.map((opt, index) => ({
    budget_id: budget.id,
    payment_method_id: opt.paymentMethodId,
    label_snapshot: opt.label.trim(),
    surcharge_percent: opt.surchargePercent,
    installments: opt.installments,
    total_min: applySurcharge(totalMin, opt.surchargePercent),
    total_max: applySurcharge(totalMax, opt.surchargePercent),
    sort_order: index,
  }));
  const { error: optErr } = await supabase
    .from("budget_payment_options")
    .insert(optionsPayload);
  if (optErr) {
    await supabase.from("budgets").delete().eq("id", budget.id);
    console.error("[crm] createBudget options error:", optErr);
    return { error: "No pudimos guardar los medios de pago." };
  }

  return { success: true, budgetId: budget.id };
}
