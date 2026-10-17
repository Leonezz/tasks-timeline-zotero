/**
 * Reading the start (DTSTART) and end (UNTIL) of a rule Tasks Timeline 0.1
 * wrote, as the calendar days @tasks-timeline/components 0.9 reads them
 * (its rule-boundaries module): floating and TZID wall-clock times and UTC
 * midnight as written, and other UTC times, which the 0.8 editor wrote for
 * local midnight, in local time. Pure: runs under Node unit tests.
 */

export interface RuleDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
  /** Ends in Z: a UTC instant rather than a wall-clock time. */
  utc: boolean;
}

/** How the library reads a rule's start. */
export interface RuleStart {
  /** YYYY-MM-DD. */
  day: string;
  /** The start's time of day in its frame, in seconds. */
  seconds: number;
  /** For a UTC start read in local time: its time of day in UTC. */
  utcSeconds?: number;
}

const DAY_MS = 86_400_000;
const RULE_DATE =
  /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})(Z)?)?$/i;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (date: { year: number; month: number; day: number }) =>
  `${date.year}-${pad(date.month)}-${pad(date.day)}`;
const secondsOf = (time: { hour: number; minute: number; second: number }) =>
  time.hour * 3600 + time.minute * 60 + time.second;
const localDay = (date: Date) =>
  isoDay({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
const utcMs = (date: RuleDate) =>
  Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    date.hour,
    date.minute,
    date.second,
  );

/** "20261016", "2026-10-16", "20261016T090000" or "20261016T090000Z". */
export function parseRuleDate(value: string): RuleDate | null {
  const match = RULE_DATE.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, z] = match;
  const date: RuleDate = {
    year: +y,
    month: +m,
    day: +d,
    hour: Number(hh ?? 0),
    minute: Number(mm ?? 0),
    second: Number(ss ?? 0),
    hasTime: hh !== undefined,
    utc: z !== undefined,
  };
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const possible =
    probe.getUTCMonth() === date.month - 1 &&
    probe.getUTCDate() === date.day &&
    date.hour <= 23 &&
    date.minute <= 59 &&
    date.second <= 59;
  return possible ? date : null;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function readRuleStart(date: RuleDate, tzid?: string): RuleStart {
  const inLocalTime =
    date.hasTime && date.utc && !tzid && secondsOf(date) !== 0;
  if (!inLocalTime) {
    return { day: isoDay(date), seconds: secondsOf(date) };
  }
  const instant = new Date(utcMs(date));
  return {
    day: localDay(instant),
    seconds: secondsOf({
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
    }),
    utcSeconds: secondsOf(date),
  };
}

/** The wall-clock time of a UTC instant in a time zone. */
function wallTimeIn(zone: string, ms: number): RuleDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
    hasTime: true,
    utc: false,
  };
}

const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/**
 * The last day a daily or longer rule can fall on. An end with a time
 * before the start's time of day ends the day before; for a UTC start read
 * in local time this is worked out in UTC, as rrule steps such a rule.
 */
export function readRuleEndDay(
  until: RuleDate,
  start: RuleStart,
  tzid?: string,
): string {
  if (!until.hasTime) return isoDay(until);
  if (start.utcSeconds !== undefined) {
    const endDay = Date.UTC(until.year, until.month - 1, until.day);
    const lastDayStart =
      start.utcSeconds <= secondsOf(until) ? endDay : endDay - DAY_MS;
    return localDay(new Date(lastDayStart + start.utcSeconds * 1000));
  }
  const wall = until.utc && tzid ? wallTimeIn(tzid, utcMs(until)) : until;
  const day = isoDay(wall);
  return secondsOf(wall) < start.seconds ? dayBefore(day) : day;
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** The weekday of a day as an RRULE BYDAY code. */
export const weekdayCode = (day: string) =>
  ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
    new Date(`${day}T00:00:00Z`).getUTCDay()
  ];

/** Whole periods (days, Monday weeks, months, years) from `from` to `to`. */
export function periodsBetween(
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
  from: string,
  to: string,
): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  switch (freq) {
    case "DAILY":
      return dayNumber(to) - dayNumber(from);
    case "WEEKLY": {
      // 1970-01-01 was a Thursday; weeks start on Monday, as rrule's WKST=MO
      const week = (day: string) => Math.floor((dayNumber(day) + 3) / 7);
      return week(to) - week(from);
    }
    case "MONTHLY":
      return ty * 12 + tm - (fy * 12 + fm);
    case "YEARLY":
      return ty - fy;
  }
}
