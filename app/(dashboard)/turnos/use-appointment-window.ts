"use client";

import { format } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Rango que trajo la página, en ISO (ver `appointmentWindow` en page.tsx). */
export type LoadedWindow = { start: string; end: string };

/**
 * La página sólo trae los turnos de una ventana alrededor de `?fecha=`. Sin
 * esto, un turno agendado para dentro de dos meses se guardaba bien pero la
 * agenda nunca lo mostraba: el día se veía vacío, como si estuviera libre.
 *
 * Cuando el rango visible se sale de lo cargado, movemos `?fecha=` al primer
 * día visible y el server trae esa ventana. Cambiar sólo el query no remonta
 * la agenda: la vista, el día y el filtro de profesional quedan como estaban.
 *
 * Devuelve `true` mientras el rango visible todavía no está cargado.
 */
export function useAppointmentWindow(
  range: { start: Date; end: Date } | null,
  loaded: LoadedWindow,
): boolean {
  const router = useRouter();
  const pathname = usePathname();

  const outside =
    range !== null &&
    (range.start.getTime() < Date.parse(loaded.start) ||
      range.end.getTime() > Date.parse(loaded.end));
  const anchor = range ? format(range.start, "yyyy-MM-dd") : null;

  useEffect(() => {
    if (!outside || !anchor) return;
    router.replace(`${pathname}?fecha=${anchor}`, { scroll: false });
  }, [outside, anchor, pathname, router]);

  return outside;
}
