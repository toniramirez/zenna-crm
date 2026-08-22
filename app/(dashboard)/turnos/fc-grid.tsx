"use client";

import esLocale from "@fullcalendar/core/locales/es";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { ComponentProps, Ref } from "react";

/**
 * La grilla de FullCalendar, con sus plugins y el locale ya adentro.
 *
 * Existe sólo para que todo `@fullcalendar/*` viva en un módulo aparte: son
 * ~280 KB sin comprimir que la agenda del teléfono no usa nunca —abajo de
 * 768px `CalendarView` devuelve `MobileAgenda` y sale antes de llegar acá— y
 * que en el escritorio no tienen por qué frenar el primer dibujo del toolbar.
 * Quien lo importa lo hace con `next/dynamic`, así el chunk se baja recién
 * cuando la grilla se va a montar de verdad.
 *
 * `calendarRef` va como prop y no como `ref` propio: el componente que se
 * exporta acá es una función y el ref que hace falta es el de la clase
 * `FullCalendar` de adentro, no el del wrapper.
 */
export type FcGridProps = Omit<
  ComponentProps<typeof FullCalendar>,
  "plugins" | "locale"
> & {
  calendarRef?: Ref<FullCalendar>;
};

export function FcGrid({ calendarRef, ...options }: FcGridProps) {
  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[resourceTimeGridPlugin, timeGridPlugin, interactionPlugin]}
      locale={esLocale}
      {...options}
    />
  );
}
