"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import type { PinActionState } from "../../finanzas/pin-actions";
import { FINANZAS_PIN, FINANZAS_PIN_MAX_AGE } from "../../finanzas/pin-config";
import { ARCHIVO_PIN_COOKIE, ARCHIVO_PIN_PATH } from "./pin-config";

export async function submitArchivoPin(
  formData: FormData,
): Promise<PinActionState> {
  await requireRole(["owner", "receptionist"]);

  const pin = String(formData.get("pin") ?? "").trim();
  if (pin !== FINANZAS_PIN) {
    return { error: "PIN incorrecto" };
  }

  const store = await cookies();
  store.set(ARCHIVO_PIN_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ARCHIVO_PIN_PATH,
    maxAge: FINANZAS_PIN_MAX_AGE,
  });

  revalidatePath(ARCHIVO_PIN_PATH);
  return {};
}
