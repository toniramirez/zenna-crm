"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { expenseSchema } from "@/lib/validations/expenses";
import { recordPaymentSchema } from "@/lib/validations/payments";
import { fieldErrorsFromZod } from "@/lib/zod-helpers";

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

  const appointmentId = formData.get("appointmentId");

  const supabase = await createClient();

  // Seña / adelanto: si el turno tiene una seña cargada, la registramos como
  // una línea de pago más (con su método original) además del saldo que cobra
  // la recepción. Así el ingreso queda registrado completo el día del turno.
  if (typeof appointmentId === "string" && Array.isArray(lines)) {
    const { data: appt } = await supabase
      .from("appointments")
      .select("deposit_amount, deposit_method")
      .eq("id", appointmentId)
      .single();

    const depositAmount = Number(appt?.deposit_amount ?? 0);
    if (depositAmount > 0 && appt?.deposit_method) {
      lines = [
        ...lines,
        { method: appt.deposit_method, amount: depositAmount },
      ];
    }
  }

  const parsed = recordPaymentSchema.safeParse({
    appointmentId,
    lines,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFromZod(parsed) };

  const { error } = await supabase.rpc("record_appointment_payment", {
    p_appointment_id: parsed.data.appointmentId,
    p_lines: parsed.data.lines.filter((l) => l.amount > 0),
    p_notes: parsed.data.notes || undefined,
  });

  if (error) {
    if (error.code === "42501") {
      return { error: "No tenés permiso para registrar pagos." };
    }
    if (error.code === "P0002") {
      return { error: "El turno ya no existe." };
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
