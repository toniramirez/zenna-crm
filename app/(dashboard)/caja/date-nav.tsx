"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { shiftDateStr, todayDateStr } from "@/lib/dates";

function dateStrToLocalDate(dateStr: string): Date {
  // Parse "YYYY-MM-DD" as local-noon to avoid TZ edge cases shifting the day.
  return parseISO(dateStr + "T12:00:00");
}

function localDateToStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CajaDateNav({ dateStr }: { dateStr: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const prev = shiftDateStr(dateStr, -1);
  const next = shiftDateStr(dateStr, 1);
  const today = todayDateStr();
  const isToday = dateStr === today;

  const selectedDate = dateStrToLocalDate(dateStr);
  const friendlyLabel = format(selectedDate, "EEEE d 'de' MMMM", {
    locale: es,
  });

  function handleSelect(d: Date | undefined) {
    if (!d) return;
    const target = localDateToStr(d);
    setOpen(false);
    if (target === today) {
      router.push("/caja");
    } else {
      router.push(`/caja?date=${target}`);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button asChild variant="outline" size="icon" className="size-9">
        <Link href={`/caja?date=${prev}`} aria-label="Día anterior">
          <ChevronLeft className="size-4" />
        </Link>
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 px-3 capitalize-first font-medium min-w-[200px] justify-center gap-2"
          >
            <CalendarIcon className="size-3.5 text-muted-foreground" />
            <span className="text-sm">{friendlyLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate}
            locale={es}
            captionLayout="dropdown"
            autoFocus
          />
        </PopoverContent>
      </Popover>

      <Button asChild variant="outline" size="icon" className="size-9">
        <Link href={`/caja?date=${next}`} aria-label="Día siguiente">
          <ChevronRight className="size-4" />
        </Link>
      </Button>

      {!isToday ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/caja">Hoy</Link>
        </Button>
      ) : null}
    </div>
  );
}
