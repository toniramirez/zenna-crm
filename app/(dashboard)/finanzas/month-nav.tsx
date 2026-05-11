import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function MonthNav({
  month,
  basePath = "/finanzas",
  extraParams = "",
}: {
  month: string; // YYYY-MM
  basePath?: string;
  extraParams?: string;
}) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const label = format(parseISO(month + "-01T12:00:00"), "MMMM yyyy", {
    locale: es,
  });
  const buildHref = (m: string) =>
    `${basePath}?month=${m}${extraParams ? `&${extraParams}` : ""}`;

  return (
    <div className="flex items-center gap-1.5">
      <Button asChild variant="outline" size="icon" className="size-9">
        <Link href={buildHref(prev)} aria-label="Mes anterior">
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <span className="font-medium px-4 py-1.5 rounded-md bg-muted/40 text-sm capitalize-first min-w-[180px] text-center">
        {label}
      </span>
      <Button asChild variant="outline" size="icon" className="size-9">
        <Link href={buildHref(next)} aria-label="Mes siguiente">
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
