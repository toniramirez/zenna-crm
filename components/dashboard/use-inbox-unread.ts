"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { countInboxUnread } from "@/lib/inbox-unread";
import { createClient } from "@/lib/supabase/client";
import { useVisiblePoll } from "@/lib/use-visible-poll";

/**
 * Chats sin leer de la bandeja, en vivo.
 *
 * Cuenta conversaciones, no mensajes: el globo dice cuántas charlas hay sin
 * abrir, que es lo que se ve en la lista como globos verdes.
 *
 * El layout del dashboard cuenta los no leídos una vez, en el servidor, pero
 * el layout no se vuelve a renderizar al navegar entre secciones: sin esto el
 * número quedaba congelado en el que había al entrar y, mientras alguien
 * estaba en Turnos o en Caja, no se enteraba de que había llegado un mensaje.
 *
 * Mismo mecanismo que usa la bandeja: realtime para reaccionar en el momento y
 * un poll de respaldo por si la suscripción se cae (pasa al volver de segundo
 * plano en el teléfono). El poll es lento a propósito — es una consulta que
 * corre en toda la app, no sólo en /crm.
 *
 * Un minuto y no veinte segundos porque el poll ya no es el que trae la
 * novedad: el realtime la trae en el momento, y `useVisiblePoll` refetchea
 * solo al volver a la app, que es el único hueco que el realtime deja. Lo que
 * queda es el respaldo de una suscripción caída con la app abierta y quieta.
 */
const POLL_MS = 60_000;

export function useInboxUnread(initial: number, enabled: boolean): number {
  const [count, setCount] = useState(initial);

  // El servidor manda un número nuevo en cada navegación con recarga; si no lo
  // tomamos, un valor viejo del cliente lo pisaría. Se ajusta durante el
  // render y no en un efecto: así no hay un frame con el número anterior.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setCount(initial);
  }

  // Un solo cliente para el hook: `createClient()` adentro del efecto lo
  // recreaba en cada corrida y con él la suscripción.
  const supabase = useMemo(() => createClient(), []);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setCount(await countInboxUnread(supabase));
  }, [enabled, supabase]);

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel("inbox-unread")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void refetch(),
      )
      .subscribe();

    void refetch();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, refetch, supabase]);

  useVisiblePoll(refetch, POLL_MS, enabled);

  return count;
}
