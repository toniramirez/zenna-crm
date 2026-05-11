"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  FINANZAS_PIN,
  FINANZAS_PIN_COOKIE,
  FINANZAS_PIN_MAX_AGE,
} from "./pin-config";

export type PinActionState = {
  error?: string;
};

export async function submitFinanzasPin(
  formData: FormData,
): Promise<PinActionState> {
  await requireRole("owner");

  const pin = String(formData.get("pin") ?? "").trim();
  if (pin !== FINANZAS_PIN) {
    return { error: "PIN incorrecto" };
  }

  const store = await cookies();
  store.set(FINANZAS_PIN_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/finanzas",
    maxAge: FINANZAS_PIN_MAX_AGE,
  });

  revalidatePath("/finanzas");
  return {};
}

export async function clearFinanzasPin() {
  await requireRole("owner");
  const store = await cookies();
  store.set(FINANZAS_PIN_COOKIE, "", {
    path: "/finanzas",
    maxAge: 0,
  });
  revalidatePath("/finanzas");
}
