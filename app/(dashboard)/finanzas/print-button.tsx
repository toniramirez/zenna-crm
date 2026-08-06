"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Imprime el reporte (o lo guarda como PDF desde el diálogo del navegador).
 *
 * Abre todos los <details> antes de imprimir y los deja como estaban después:
 * los navegadores nuevos ocultan el contenido cerrado con `content-visibility`,
 * así que con CSS solo no alcanza para que salga el desglose completo.
 */
export function PrintReportButton({ label = "Imprimir / PDF" }: { label?: string }) {
  function handlePrint() {
    const report = document.querySelector(".print-report");
    const collapsed = report
      ? Array.from(report.querySelectorAll<HTMLDetailsElement>("details:not([open])"))
      : [];

    collapsed.forEach((d) => {
      d.open = true;
    });

    const restore = () => {
      collapsed.forEach((d) => {
        d.open = false;
      });
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    window.print();
    // Safari no siempre dispara afterprint; el timeout es el plan B.
    window.setTimeout(restore, 1000);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handlePrint}
      className="print-hide gap-2"
    >
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
