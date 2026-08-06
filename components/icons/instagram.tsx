import type { SVGProps } from "react";

/**
 * Glifo de Instagram.
 *
 * Va acá y no desde `lucide-react` porque lucide sacó los íconos de marca en la
 * v1. Está dibujado con el mismo lenguaje que el resto del set (24×24, trazo de
 * 2, `currentColor`) para que conviva sin desentonar con los demás íconos.
 */
export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}
