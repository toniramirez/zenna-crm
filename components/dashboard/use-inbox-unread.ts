"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Mensajes sin leer de toda la bandeja, en vivo.
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
 */
const POLL_MS = 20_000;

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

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase
        .from("conversations")
        .select("unread_count")
        .eq("archived", false)
        .gt("unread_count", 0);
      if (cancelled || !data) return;
      setCount(data.reduce((total, row) => total + row.unread_count, 0));
    }

    const channel = supabase
      .channel("inbox-unread")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void refetch(),
      )
      .subscribe();

    const pollId = setInterval(() => void refetch(), POLL_MS);
    void refetch();

    return () => {
      cancelled = true;
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return count;
}
