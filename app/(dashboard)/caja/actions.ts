"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { todayDateStr } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { expenseSchema } from "@/lib/validations/expenses";
import { closeCajaSchema, recordPaymentSchema } from "@/lib/validations/payments";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";
import { computeDayTotals } from "./day-totals";

export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

// ───────────────────────────────────────────── Payments

export async function recordPaymentAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["owner", "receptionist"]);

  const linesRaw = formData.get("lines");
  let lines: unknown = [];
  if (typeof linesRaw === "string") {
    try {
      lines = JSON.parse(linesRaw);
    } catch {
      return { error: "Formato de líneas inválido." };
    }
  }

  const parsed = recordPaymentSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    lines,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();

  // Sólo lo que falta: la seña ya es un movimiento propio (en la caja del día
  // en que entró) y cobrar_turno la deja intacta. Sin líneas, cierra la venta
  // de un turno que la seña cubrió entera.
  const { error } = await supabase.rpc("cobrar_turno", {
    p_appointment_id: parsed.data.appointmentId,
    p_lines: parsed.data.lines,
    p_notes: parsed.data.notes || undefined,
  });

  if (error) {
    if (error.code === "42501") {
      return { error: "No tenés permiso para registrar pagos." };
    }
    if (error.code === "P0002") {
      return { error: "El turno ya no existe." };
    }
    if (error.hint === "ya_cobrado") {
      return { error: "Este turno ya estaba cobrado. Recargá la página." };
    }
    if (error.hint === "sin_monto") {
      return { error: "El turno no tiene seña: cargá lo que pagó." };
    }
    console.error("[caja] record_appointment_payment failed:", error);
    if (process.env.NODE_ENV !== "production") {
      return {
        error: `Error DB${error.code ? ` ${error.code}` : ""}: ${error.message ?? "desconocido"}`,
      };
    }
    return { error: "No pudimos registrar el cobro. Intentalo de nuevo." };
  }

  revalidatePath("/caja");
  revalidatePath("/turnos");
  return { success: true };
}

// ───────────────────────────────────────────── Expenses

export async function createExpenseAction(
  formData: FormData,
): Promise<ActionState> {
  await requireRole("owner");

  const parsed = expenseSchema.safeParse({
    category: formData.get("category"),
    description: formData.get("description") || undefined,
    amount: Number(formData.get("amount")),
    expenseDate: formData.get("expenseDate"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    cashSourceDate: formData.get("cashSourceDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    category: parsed.data.category,
    description: parsed.data.description || null,
    amount: parsed.data.amount,
    expense_date: parsed.data.expenseDate,
    payment_method: parsed.data.paymentMethod || null,
    cash_source_date:
      parsed.data.paymentMethod === "cash"
        ? parsed.data.cashSourceDate || parsed.data.expenseDate
        : null,
    notes: parsed.data.notes || null,
  });

  if (error) {
    console.error("[caja] expense insert failed:", error);
    return { error: "No pudimos registrar el egreso." };
  }

  revalidatePath("/caja");
  return { success: true };
}

export async function deleteExpenseAction(id: string): Promise<ActionState> {
  await requireRole("owner");

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);

  if (error) return { error: "No pudimos eliminar el egreso." };

  revalidatePath("/caja");
  return { success: true };
}

// ───────────────────────────────────────────── Cierre de caja

export async function closeCajaAction(
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole(["owner", "receptionist"]);

  const parsed = closeCajaSchema.safeParse({
    cajaDate: formData.get("cajaDate"),
    // Vacío no es "$0": el cierre exige que alguien haya contado.
    countedCash:
      formData.get("countedCash") === ""
        ? Number.NaN
        : Number(formData.get("countedCash")),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };
  if (parsed.data.cajaDate > todayDateStr()) {
    return { error: "No se puede cerrar una caja de un día que todavía no llegó." };
  }

  const supabase = await createClient();
  const isOwner = ctx.profile.role === "owner";

  // Los montos se recalculan acá, no se confían al cliente: el cierre es la
  // foto de lo que el sistema dice que tendría que haber.
  const [paymentsResult, expensesResult] = await Promise.all([
    supabase
      .from("payments")
      .select("method, amount, is_deposit")
      .eq("caja_date", parsed.data.cajaDate),
    supabase
      .from("expenses")
      .select("amount")
      .eq("payment_method", "cash")
      .eq("cash_source_date", parsed.data.cajaDate),
  ]);

  if (paymentsResult.error || expensesResult.error) {
    console.error(
      "[caja] close totals failed:",
      paymentsResult.error ?? expensesResult.error,
    );
    return { error: "No pudimos calcular los totales de la caja." };
  }

  const cashExpenses = (expensesResult.data ?? []).reduce(
    (acc, e) => acc + Number(e.amount),
    0,
  );
  const totals = computeDayTotals(paymentsResult.data ?? [], cashExpenses);

  const row = {
    caja_date: parsed.data.cajaDate,
    cash_income: totals.cash,
    cash_expenses: totals.cashExpenses,
    expected_cash: totals.expectedCash,
    counted_cash: parsed.data.countedCash,
    transfer_income: totals.transfer,
    other_income: totals.other,
    notes: parsed.data.notes || null,
    closed_by: ctx.userId,
    closed_at: new Date().toISOString(),
  };

  // La recepción cierra una vez; corregir un cierre ya hecho es de la dueña
  // (la política de RLS lo hace cumplir igual).
  const { error } = isOwner
    ? await supabase.from("cash_closings").upsert(row)
    : await supabase.from("cash_closings").insert(row);

  if (error) {
    if (error.code === "23505") {
      return { error: "Esta caja ya está cerrada. Sólo la dueña puede corregirla." };
    }
    console.error("[caja] close failed:", error);
    return { error: "No pudimos cerrar la caja." };
  }

  revalidatePath("/caja");
  revalidatePath("/caja/archivo");
  return { success: true };
}

export async function reopenCajaAction(cajaDate: string): Promise<ActionState> {
  await requireRole("owner");

  const supabase = await createClient();
  const { error } = await supabase
    .from("cash_closings")
    .delete()
    .eq("caja_date", cajaDate);

  if (error) return { error: "No pudimos reabrir la caja." };

  revalidatePath("/caja");
  revalidatePath("/caja/archivo");
  return { success: true };
}
