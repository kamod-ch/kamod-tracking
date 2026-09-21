/**
 * Calendar-day boundaries use an explicit IANA timezone, never the server default zone.
 */
export type LocalDateRange = {
  readonly from: string;
  readonly to: string;
};

export const formatLocalDate = (instantUtc: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instantUtc);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Unable to format local date for zone ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
};

/** Inclusive local-date range as YYYY-MM-DD strings. */
export const enumerateLocalDates = (from: string, to: string): string[] => {
  if (from > to) {
    return [];
  }
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    const next = addLocalDays(cursor, 1);
    if (next === cursor) {
      break;
    }
    cursor = next;
  }
  return dates;
};

const addLocalDays = (localDate: string, days: number): string => {
  const [y, m, d] = localDate.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d! + days);
  const nd = new Date(utc);
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

/** UTC half-open interval [start, end) covering one local calendar day in `timeZone`. */
export const localDayUtcBounds = (
  localDate: string,
  timeZone: string,
): { readonly startUtc: Date; readonly endUtc: Date } => {
  const startUtc = zonedLocalDateTimeToUtc(localDate, "00:00:00", timeZone);
  const nextDate = addLocalDays(localDate, 1);
  const endUtc = zonedLocalDateTimeToUtc(nextDate, "00:00:00", timeZone);
  return { startUtc, endUtc };
};

/**
 * Resolve UTC instant for local wall time using offset iteration (handles DST).
 */
export const zonedLocalDateTimeToUtc = (
  localDate: string,
  localTime: string,
  timeZone: string,
): Date => {
  const [hour, minute, second] = localTime.split(":").map((part) => Number(part));
  const [year, month, day] = localDate.split("-").map(Number);
  let guessMs = Date.UTC(year!, month! - 1, day!, hour ?? 0, minute ?? 0, second ?? 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const targetMs = Date.UTC(year!, month! - 1, day!, hour ?? 0, minute ?? 0, second ?? 0);
  for (let i = 0; i < 4; i += 1) {
    const probe = new Date(guessMs);
    const parts = dtf.formatToParts(probe);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second"),
    );
    const diffMs = targetMs - asUtc;
    if (diffMs === 0) {
      return probe;
    }
    guessMs += diffMs;
  }
  return new Date(guessMs);
};
