import { cookies } from "next/headers";

// Mismo PIN que Finanzas, pero el desbloqueo es aparte: la cookie va atada a
// /caja/archivo, así abrir una sección no abre la otra.
export const ARCHIVO_PIN_COOKIE = "caja_archivo_pin_ok";
export const ARCHIVO_PIN_PATH = "/caja/archivo";

export async function hasArchivoPinAccess(): Promise<boolean> {
  const store = await cookies();
  return store.get(ARCHIVO_PIN_COOKIE)?.value === "1";
}
