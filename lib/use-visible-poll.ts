"use client";

import { useEffect, useRef } from "react";

/**
 * Poll de respaldo que sólo corre con la app a la vista.
 *
 * Todas las pantallas vivas de Zenna (bandeja, mensajes de un chat, globo de
 * no leídos) escuchan realtime de Supabase y además sondean por si la
 * suscripción se cae. El sondeo estaba fijo y sin condiciones: la bandeja
 * pedía las 100 conversaciones con su clienta cada 5 s y el chat abierto
 * traía sus 500 mensajes cada 3 s, estuviera la app adelante, atrás o con la
 * pantalla apagada. En el teléfono eso es lo que se siente como lentitud —la
 * radio nunca se duerme, y cada respuesta reemplaza listas enteras en medio
 * del scroll.
 *
 * Este hook cambia dos cosas:
 *
 * 1. **Con la pestaña oculta no sondea.** No hay nadie mirando, y en iOS los
 *    timers de una pestaña en segundo plano se congelan igual: lo único que
 *    lograba era una ráfaga de pedidos atrasados al volver.
 * 2. **Al volver a la vista refetchea en el acto.** Esto además arregla algo
 *    real: volviendo de segundo plano el websocket de realtime suele estar
 *    muerto, y antes había que esperar el siguiente tick para enterarse de
 *    los mensajes que habían entrado. Ahora los datos están frescos antes de
 *    que se termine la animación de apertura.
 *
 * Con eso el intervalo puede ser mucho más largo sin que nada se sienta más
 * lento: el realtime sigue siendo el camino rápido y esto es sólo la red de
 * seguridad.
 *
 * `fn` se lee siempre desde un ref: el llamador puede pasar una función nueva
 * en cada render sin reprogramar el intervalo.
 */
export function useVisiblePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      stop();
      timer = setInterval(() => void fnRef.current(), intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fnRef.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    // `focus` no es redundante: al volver a la PWA desde otra app iOS a veces
    // dispara sólo uno de los dos, y perder el refetch de la vuelta es
    // justamente el caso que este hook viene a cubrir.
    window.addEventListener("focus", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [intervalMs, enabled]);
}
