"use client";

import { type RefObject, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Lo que sigue al dedo durante el arrastre: lee `--swipe-x` del contenedor
 * (ver `useHorizontalSwipe`). Con el dedo apoyado va pegado, sin transición;
 * al soltar sin cambiar de día vuelve a su lugar con una.
 */
export const SWIPE_FOLLOW =
  "translate-x-[var(--swipe-x,0px)] transition-[translate] duration-200 ease-out group-data-[swiping=true]/swipe:transition-none";

/** El contenido nuevo entra desde el lado hacia el que se fue. */
export function enterAnimation(from: -1 | 0 | 1) {
  if (from === 0) return undefined;
  return cn(
    "animate-in fade-in duration-200 ease-out",
    from === 1 ? "slide-in-from-right-8" : "slide-in-from-left-8",
  );
}

/**
 * Arrastre horizontal para pasar de día o de semana, como en el calendario
 * del teléfono. Mientras el dedo está apoyado, el contenido lo sigue (la
 * variable `--swipe-x` del contenedor); al soltar, si recorrió un cuarto del
 * ancho o salió rápido, cambia — si no, vuelve a su lugar.
 *
 * Va con listeners nativos y no con los de React: para quedarse con el gesto
 * hay que poder `preventDefault()` en `touchmove`, y React los registra
 * pasivos. Hasta decidir hacia dónde va el dedo no se toca nada, así el
 * desplazamiento vertical de la lista sigue siendo del navegador.
 *
 * El contenedor lleva `group/swipe` y lo que se mueve, `SWIPE_FOLLOW`.
 */
export function useHorizontalSwipe(
  ref: RefObject<HTMLElement | null>,
  onSwipe: (direction: -1 | 1) => void,
) {
  const onSwipeRef = useRef(onSwipe);
  useEffect(() => {
    onSwipeRef.current = onSwipe;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let gesture: {
      x: number;
      y: number;
      t: number;
      axis: "x" | "y" | null;
      dx: number;
    } | null = null;

    function onStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (e.touches.length !== 1 || !touch) {
        gesture = null;
        return;
      }
      // Desde el borde es el "atrás" del sistema: ese gesto no es nuestro.
      if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) {
        gesture = null;
        return;
      }
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        t: e.timeStamp,
        axis: null,
        dx: 0,
      };
    }

    function onMove(e: TouchEvent) {
      const touch = e.touches[0];
      if (!gesture || !touch || !el) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (gesture.axis === null) {
        if (Math.hypot(dx, dy) < 10) return;
        gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
        if (gesture.axis === "x") el.dataset.swiping = "true";
      }
      if (gesture.axis !== "x") return;
      if (e.cancelable) e.preventDefault();
      gesture.dx = dx;
      el.style.setProperty("--swipe-x", `${dx}px`);
    }

    function onEnd(e: TouchEvent) {
      const g = gesture;
      gesture = null;
      if (!g || g.axis !== "x" || !el) return;

      const distance = Math.abs(g.dx);
      const velocity = distance / Math.max(1, e.timeStamp - g.t);
      const commit =
        distance > el.clientWidth * 0.22 || (velocity > 0.45 && distance > 30);

      if (!commit) {
        delete el.dataset.swiping;
        el.style.setProperty("--swipe-x", "0px");
        return;
      }
      // El contenido viejo no vuelve: se cambia en el lugar y el nuevo entra
      // desde el costado. La transición se apaga hasta el cuadro siguiente
      // para que el salto a 0 no se vea.
      el.style.setProperty("--swipe-x", "0px");
      requestAnimationFrame(() => {
        delete el.dataset.swiping;
      });
      onSwipeRef.current(g.dx < 0 ? 1 : -1);
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);
}
