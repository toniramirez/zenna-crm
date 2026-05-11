import { addDays, parseISO, startOfMonth, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Timezone everything in Zenna is anchored to. Hard-coded for now; once the
 * business_settings row is populated we should read it from there.
 */
export const ZENNA_TZ = "America/Argentina/Cordoba";

/** Today's date in the configured timezone, as "YYYY-MM-DD". */
export function todayDateStr(): string {
  return formatInTimeZone(new Date(), ZENNA_TZ, "yyyy-MM-dd");
}

/** Validate a "YYYY-MM-DD" string and return it, or fall back to today. */
export function safeDateStr(input: string | undefined | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const parsed = parseISO(input);
    if (!Number.isNaN(parsed.getTime())) return input;
  }
  return todayDateStr();
}

/** "YYYY-MM-DD" → ISO range (start..end) covering that day in our timezone. */
export function dayRangeISO(dateStr: string): { start: string; end: string } {
  const start = fromZonedTime(`${dateStr}T00:00:00.000`, ZENNA_TZ);
  const end = fromZonedTime(`${dateStr}T23:59:59.999`, ZENNA_TZ);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * First and last day of the month containing `dateStr`, as "YYYY-MM-DD"
 * strings (used to query the expenses table which stores plain dates).
 */
export function monthBounds(
  dateStr: string,
): { firstDay: string; lastDay: string } {
  const d = parseISO(dateStr + "T12:00:00");
  const first = startOfMonth(d);
  const year = first.getFullYear();
  const month = first.getMonth(); // 0..11
  const lastDayN = new Date(year, month + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    firstDay: `${year}-${pad(month + 1)}-01`,
    lastDay: `${year}-${pad(month + 1)}-${pad(lastDayN)}`,
  };
}

export function shiftDateStr(dateStr: string, days: number): string {
  const d = parseISO(dateStr + "T12:00:00");
  const shifted = days >= 0 ? addDays(d, days) : subDays(d, -days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}
