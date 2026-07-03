/**
 * Small, dependency-free date helpers shared by the app and pipeline.
 * Month boundaries are computed in a given IANA timezone so a user in
 * America/Los_Angeles gets correct monthly rollups regardless of where the
 * pipeline runs (UTC on GitHub Actions).
 */

/** Format a Date as `YYYY-MM-DD` in the given tz. */
export function toDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts; // en-CA yields YYYY-MM-DD
}

/** Format a Date as `YYYY-MM` in the given tz. */
export function toMonthKey(date: Date, tz: string): string {
  return toDateKey(date, tz).slice(0, 7);
}

/** Parse a Plaid `YYYY-MM-DD` string into a UTC-noon Date (avoids tz drift). */
export function parsePlaidDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

/** Day-of-month (1-based) for pace projection, in the given tz. */
export function dayOfMonth(date: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(date),
  );
}

/** Number of days in the month containing `date`, in the given tz. */
export function daysInMonth(date: Date, tz: string): number {
  const [y, m] = toMonthKey(date, tz).split('-').map(Number);
  // Day 0 of the next month == last day of this month.
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Linear month-end projection from month-to-date spend. */
export function projectMonthEnd(monthToDate: number, date: Date, tz: string): number {
  const dom = dayOfMonth(date, tz);
  const dim = daysInMonth(date, tz);
  if (dom <= 0) return monthToDate;
  return (monthToDate / dom) * dim;
}
