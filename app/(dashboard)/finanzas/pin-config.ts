import { cookies } from "next/headers";

export const FINANZAS_PIN_COOKIE = "finanzas_pin_ok";
export const FINANZAS_PIN = process.env.FINANZAS_PIN ?? "0419";
export const FINANZAS_PIN_MAX_AGE = 60 * 60 * 8;

export async function hasFinanzasPinAccess(): Promise<boolean> {
  const store = await cookies();
  return store.get(FINANZAS_PIN_COOKIE)?.value === "1";
}
