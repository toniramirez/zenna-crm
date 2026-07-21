"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  editTemplatePaymentSchema,
  expenseTemplateSchema,
  payTemplateSchema,
} from "@/lib/validations/expense-templates";
import { payProfessionalSchema } from "@/lib/validations/professional-payouts";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

function parseTemplate(formData: FormData) {
  return expenseTemplateSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    defaultPaymentMethod: formData.get("defaultPaymentMethod") || undefined,
    defaultAmount: formData.get("defaultAmount")
      ? Number(formData.get("defaultAmount"))
      : null,
    dueDay: Number(formData.get("dueDay") ?? 1),
    notes: formData.get("notes") || undefined,
    active: formData.get("active") === "true",
  });
}

export async function createTemplateAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = parseTemplate(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("expense_templates").insert({
    name: parsed.data.name,
    category: parsed.data.category,
    default_payment_method: parsed.data.defaultPaymentMethod || null,
    default_amount: parsed.data.defaultAmount ?? null,
    due_day: parsed.data.dueDay,
    notes: parsed.data.notes || null,
    active: parsed.data.active,
  });

  if (error) {
    console.error("[finanzas] template insert failed:", error);
    return { error: "No pudimos crear la plantilla." };
  }

  revalidatePath("/finanzas");
  return { success: true };
}

export async function updateTemplateAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = parseTemplate(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_templates")
    .update({
      name: parsed.data.name,
      category: parsed.data.category,
      default_payment_method: parsed.data.defaultPaymentMethod || null,
      default_amount: parsed.data.defaultAmount ?? null,
      due_day: parsed.data.dueDay,
      notes: parsed.data.notes || null,
      active: parsed.data.active,
    })
    .eq("id", id);

  if (error) return { error: "No pudimos guardar los cambios." };

  revalidatePath("/finanzas");
  return { success: true };
}

export async function toggleTemplateActiveAction(id: string, active: boolean) {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_templates")
    .update({ active })
    .eq("id", id);
  if (error) return { error: "No pudimos cambiar el estado." };
  revalidatePath("/finanzas");
  return { success: true };
}

export async function deleteTemplateAction(id: string) {
  await requireRole("owner");
  const supabase = await createClient();
  // Soft-delete: just deactivate. Expenses already created keep their template_id.
  const { error } = await supabase
    .from("expense_templates")
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: "No pudimos archivar la plantilla." };
  revalidatePath("/finanzas");
  return { success: true };
}

/**
 * Pay a template → creates an expense linked to it with `cash_source_date = NULL`,
 * so it doesn't affect any single day's "efectivo a rendir". Conceptually these
 * fixed expenses come from the salon's general reserves, not a specific till.
 */
export async function payTemplateAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = payTemplateSchema.safeParse({
    templateId: formData.get("templateId"),
    period: formData.get("period"),
    amount: Number(formData.get("amount")),
    expenseDate: formData.get("expenseDate"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  const { data: tpl, error: tplError } = await supabase
    .from("expense_templates")
    .select("name, category")
    .eq("id", parsed.data.templateId)
    .single();

  if (tplError || !tpl) {
    return { error: "La plantilla no existe." };
  }

  // Idempotent: if already paid for this period, refuse rather than duplicate.
  const { count } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("template_id", parsed.data.templateId)
    .eq("period", parsed.data.period);

  if ((count ?? 0) > 0) {
    return { error: "Esta plantilla ya tiene un pago registrado para ese mes." };
  }

  const { error } = await supabase.from("expenses").insert({
    category: tpl.category,
    description: tpl.name,
    amount: parsed.data.amount,
    expense_date: parsed.data.expenseDate,
    payment_method: parsed.data.paymentMethod || null,
    cash_source_date: null,
    notes: parsed.data.notes || null,
    template_id: parsed.data.templateId,
    period: parsed.data.period,
  });

  if (error) {
    console.error("[finanzas] pay template failed:", error);
    return { error: "No pudimos registrar el pago." };
  }

  revalidatePath("/finanzas");
  revalidatePath("/caja");
  return { success: true };
}

/**
 * Undo a template payment (delete the expense row). Used from the "Pagos del
 * mes" card when the user clicks the trash on a paid bill to re-open it.
 */
export async function unpayTemplateAction(
  templateId: string,
  period: string,
): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("template_id", templateId)
    .eq("period", period);
  if (error) return { error: "No pudimos revertir el pago." };
  revalidatePath("/finanzas");
  revalidatePath("/caja");
  return { success: true };
}

/**
 * Edit an existing template payment. Lets the owner fix amount, date, payment
 * method, notes and — importantly — the month (`period`) of a paid fixed
 * expense, e.g. when it was loaded under the wrong month. Guards against
 * creating two payments of the same template in the target month.
 */
export async function updateTemplatePaymentAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = editTemplatePaymentSchema.safeParse({
    expenseId: formData.get("expenseId"),
    period: formData.get("period"),
    amount: Number(formData.get("amount")),
    expenseDate: formData.get("expenseDate"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  // Load the row to make sure it's a template payment and get its template_id.
  const { data: expense, error: loadError } = await supabase
    .from("expenses")
    .select("id, template_id")
    .eq("id", parsed.data.expenseId)
    .single();

  if (loadError || !expense) {
    return { error: "No encontramos el pago." };
  }
  if (!expense.template_id) {
    return { error: "Este gasto no es un gasto fijo editable." };
  }

  // Prevent two payments of the same template in the target month.
  const { count } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("template_id", expense.template_id)
    .eq("period", parsed.data.period)
    .neq("id", expense.id);

  if ((count ?? 0) > 0) {
    return {
      error: "Esa plantilla ya tiene un pago registrado en el mes elegido.",
    };
  }

  const { error } = await supabase
    .from("expenses")
    .update({
      amount: parsed.data.amount,
      expense_date: parsed.data.expenseDate,
      period: parsed.data.period,
      payment_method: parsed.data.paymentMethod || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", expense.id);

  if (error) {
    console.error("[finanzas] update template payment failed:", error);
    return { error: "No pudimos guardar los cambios." };
  }

  revalidatePath("/finanzas");
  revalidatePath("/caja");
  return { success: true };
}

// ─────────────────────────────────────────── Pago a profesional
//
// El pago a profesional consolida en una sola transacción:
//   1. Crea un row en `expenses` con category='sueldos', professional_id y
//      period (índice único garantiza un pago por mes y por profesional).
//   2. Marca como `paid` todas las comisiones brutas pendientes generadas
//      en ese mes para esa profesional (status='paid', paid_at=now).
//
// Si algo falla a mitad de camino, revertimos el expense.

export async function payProfessionalAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = payProfessionalSchema.safeParse({
    professionalId: formData.get("professionalId"),
    period: formData.get("period"),
    amount: Number(formData.get("amount")),
    expenseDate: formData.get("expenseDate"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  const { data: pro, error: proError } = await supabase
    .from("professionals")
    .select("full_name")
    .eq("id", parsed.data.professionalId)
    .single();

  if (proError || !pro) {
    return { error: "La profesional no existe." };
  }

  // Idempotencia: el unique index ya garantiza no duplicar, pero damos un
  // mensaje más claro si el row ya existe.
  const { count } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", parsed.data.professionalId)
    .eq("period", parsed.data.period);

  if ((count ?? 0) > 0) {
    return {
      error: "Esta profesional ya tiene un pago registrado para ese mes.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("expenses")
    .insert({
      category: "sueldos",
      description: `Comisión ${pro.full_name}`,
      amount: parsed.data.amount,
      expense_date: parsed.data.expenseDate,
      payment_method: parsed.data.paymentMethod || null,
      cash_source_date: null,
      notes: parsed.data.notes || null,
      professional_id: parsed.data.professionalId,
      period: parsed.data.period,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[finanzas] pay professional insert failed:", insertError);
    return { error: "No pudimos registrar el pago." };
  }

  // Mark gross commissions generated in that period as paid.
  // Period is the first day of the month (YYYY-MM-01). We bound by created_at.
  const [py, pm] = parsed.data.period.split("-").map(Number);
  const monthStart = new Date(py, pm - 1, 1).toISOString();
  const monthEnd = new Date(py, pm, 1).toISOString();

  const { error: commError } = await supabase
    .from("commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("professional_id", parsed.data.professionalId)
    .eq("status", "pending")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  if (commError) {
    console.error(
      "[finanzas] marking commissions as paid failed, rolling back expense:",
      commError,
    );
    // Best-effort rollback
    await supabase.from("expenses").delete().eq("id", inserted.id);
    return { error: "No pudimos cerrar las comisiones del mes." };
  }

  revalidatePath("/finanzas");
  revalidatePath("/caja");
  return { success: true };
}

export async function unpayProfessionalAction(
  professionalId: string,
  period: string,
): Promise<ActionState> {
  await requireRole("owner");
  const supabase = await createClient();

  // Reabrir comisiones brutas del período (paid → pending).
  const [py, pm] = period.split("-").map(Number);
  const monthStart = new Date(py, pm - 1, 1).toISOString();
  const monthEnd = new Date(py, pm, 1).toISOString();

  const { error: commError } = await supabase
    .from("commissions")
    .update({ status: "pending", paid_at: null })
    .eq("professional_id", professionalId)
    .eq("status", "paid")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  if (commError) {
    console.error("[finanzas] reopening commissions failed:", commError);
    return { error: "No pudimos reabrir las comisiones." };
  }

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("professional_id", professionalId)
    .eq("period", period);
  if (error) return { error: "No pudimos revertir el pago." };

  revalidatePath("/finanzas");
  revalidatePath("/caja");
  return { success: true };
}
