/**
 * Repairs recurrence rules that Tasks Timeline 0.1 (with
 * @tasks-timeline/components 0.8) wrote with a start date. They were saved as
 * "🔁 DTSTART:… RRULE:…" in one block, which an Obsidian Tasks line can't
 * hold, so every edit of such a note failed. A rule is repaired only when the
 * repaired note recurs on the same days as the library reads the original;
 * otherwise the note is left for the user to fix by hand. Pure: runs under
 * Node unit tests.
 */
import {
  formatTasksMetadata,
  parseTasksFormatItem,
  taskToMarkdown,
} from "@tasks-timeline/components/tasks-format";
import type { Task } from "@tasks-timeline/components";
import {
  isValidTimeZone,
  parseRuleDate,
  periodsBetween,
  readRuleEndDay,
  readRuleStart,
  weekdayCode,
} from "./legacyRuleDates";
import type { RuleStart } from "./legacyRuleDates";

/** The task dates the note has, which say where the next occurrence counts from. */
export interface NoteDates {
  dueAt?: string;
  scheduledAt?: string;
  startAt?: string;
}

export interface LegacyRecurrenceRepair {
  /** The repaired block text, or the block unchanged when it can't be repaired. */
  text: string;
  /** Why the block can't be repaired and how to fix the note by hand. */
  error?: string;
  /**
   * For a block that can't be repaired: the block without the rule, and the
   * rule the task carries until the note is fixed. That is the original rule
   * as the library reads it ("DTSTART:…\nRRULE:…"), or `error` when the
   * library can't read it either, so a completion fails with the message.
   */
  unrepaired?: { text: string; recurringInterval: string };
}

// The characters of an RRULE, and "_" for time zones such as Buenos_Aires.
const RULE_CHARS = "[A-Za-z0-9=;:,+_\\-/]";
/** "🔁 DTSTART:… RRULE:…", the two parts separated by whitespace or glued. */
const LEGACY_RULE = new RegExp(
  `🔁\\uFE0F? *(DTSTART[;:=]${RULE_CHARS}*?)\\s*(RRULE:${RULE_CHARS}+)`,
  "u",
);
/** "DTSTART:…", "DTSTART;TZID=…:…", "DTSTART;VALUE=DATE:…" or "DTSTART=…". */
const DTSTART = /^DTSTART(?:((?:;[^:]*)?):|=)(.+)$/i;
const TZID = /;TZID=([^;:]+)/i;
const CHECKBOX_PREFIX = /^\[.\]\s*/u;
const WHEN_DONE = /^\s*when done\b/i;

const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
type Frequency = (typeof FREQUENCIES)[number];
const PERIODS: Record<Frequency, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};
const periods = (n: number, freq: Frequency) =>
  `${n} ${PERIODS[freq]}${n === 1 ? "" : "s"}`;
/** RRULE parts a rule written as text keeps with the same meaning. */
const TEXT_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "UNTIL",
  "WKST",
]);

/** A rule that can't be repaired faithfully. */
class RepairRefused extends Error {
  constructor(
    readonly reason: string,
    /** Whether the library can read the original rule. */
    readonly readable: boolean,
  ) {
    super(reason);
  }
}

const unreadable = (reason: string) => new RepairRefused(reason, false);
const unfaithful = (reason: string) => new RepairRefused(reason, true);

function manualFix(legacy: string, reason: string): string {
  return (
    `This task's recurrence "🔁 ${legacy}" was saved by an earlier version ` +
    "of Tasks Timeline with a start date, which a task note can't hold, and " +
    `it can't be repaired automatically: ${reason} To fix it, open the ` +
    `task's note in Zotero and replace "🔁 ${legacy}" with the rule as text, ` +
    'such as "🔁 every week", and put the start date after 🛫.'
  );
}

interface LegacyMatch {
  dtstart: string;
  rrule: string;
  before: string;
  after: string;
}

function findLegacyRule(text: string): LegacyMatch | null {
  const match = LEGACY_RULE.exec(text);
  if (!match) return null;
  const [span, dtstart, rrule] = match;
  return {
    dtstart,
    rrule,
    before: text.slice(0, match.index),
    after: text.slice(match.index + span.length),
  };
}

const joinAround = (before: string, after: string) =>
  [before.trimEnd(), after.trimStart()].filter(Boolean).join(" ");

export const hasLegacyRule = (text: string): boolean => LEGACY_RULE.test(text);

/** The block with a 0.8 rule taken out, for reading its other fields. */
export function withoutLegacyRule(text: string): string {
  const legacy = findLegacyRule(text);
  return legacy ? joinAround(legacy.before, legacy.after) : text;
}

function parseLine(line: string): Task {
  return parseTasksFormatItem({
    id: "",
    title: line,
    status: "todo",
    priority: "medium",
    tags: [],
  });
}

function datesOf(line: string): NoteDates {
  const task = parseLine(line);
  return {
    dueAt: task.dueAt,
    scheduledAt: task.extra?.scheduledAt,
    startAt: task.startAt,
  };
}

/** The RRULE's parts by name, refusing parts a text rule can't hold. */
function readRuleParts(rrule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    if (!part) continue;
    const [name, value] = part.split("=", 2);
    const key = name.toUpperCase();
    if (!value || parts.has(key)) {
      throw unreadable(`its part "${part}" can't be read.`);
    }
    parts.set(key, value.toUpperCase());
  }
  const count = parts.get("COUNT");
  if (count !== undefined) {
    throw unfaithful(
      `it ends after COUNT=${count} occurrences, which task notes can't ` +
        "count. Every completion writes a new note, so the rule as text " +
        `("for ${count} times") would start over each time and never end.`,
    );
  }
  for (const [key, value] of parts) {
    if (!TEXT_PARTS.has(key) || (key === "WKST" && value !== "MO")) {
      throw unfaithful(
        `it uses ${key}=${value}, which a rule written as text can't hold ` +
          "with the same meaning.",
      );
    }
  }
  return parts;
}

function readFrequency(parts: Map<string, string>): Frequency {
  const freq = parts.get("FREQ");
  if (freq === undefined) {
    throw unreadable("it has no FREQ, so it doesn't say how often it repeats.");
  }
  const known = FREQUENCIES.find((f) => f === freq);
  if (!known) {
    throw unfaithful(
      `it repeats FREQ=${freq}; a task note's rule repeats daily or less often.`,
    );
  }
  return known;
}

function readInterval(parts: Map<string, string>): number {
  const value = parts.get("INTERVAL") ?? "1";
  const interval = Number(value);
  if (!/^\d+$/.test(value) || interval < 1) {
    throw unreadable(`its INTERVAL=${value} isn't a whole number from 1 up.`);
  }
  return interval;
}

function readStart(dtstart: string): { start: RuleStart; tzid?: string } {
  const [, params = "", value = ""] = DTSTART.exec(dtstart) ?? [];
  const tzid = TZID.exec(params)?.[1];
  const date = parseRuleDate(value);
  if (!date || (tzid !== undefined && !isValidTimeZone(tzid))) {
    throw unreadable(`its start date "${dtstart}" can't be read.`);
  }
  return { start: readRuleStart(date, tzid), tzid };
}

/**
 * The rule as RRULE parts without a start date. rrule takes the day a rule
 * repeats on from DTSTART when the rule names no day; that day is written
 * out ("every week on Friday"), and the end is written as the day the
 * library reads it on.
 */
function withoutStart(
  parts: Map<string, string>,
  freq: Frequency,
  start: RuleStart,
  tzid: string | undefined,
): string {
  const rule = new Map(parts);
  const [, month, day] = start.day.split("-").map(Number);
  if (!rule.has("BYDAY") && !rule.has("BYMONTHDAY")) {
    if (freq === "WEEKLY") rule.set("BYDAY", weekdayCode(start.day));
    if (freq === "MONTHLY") rule.set("BYMONTHDAY", String(day));
    if (freq === "YEARLY") {
      if (!rule.has("BYMONTH")) rule.set("BYMONTH", String(month));
      rule.set("BYMONTHDAY", String(day));
    }
  }
  const until = rule.get("UNTIL");
  if (until !== undefined) {
    const date = parseRuleDate(until);
    if (!date) throw unreadable(`its end date "UNTIL=${until}" can't be read.`);
    rule.set("UNTIL", readRuleEndDay(date, start, tzid).replace(/-/g, ""));
  }
  return [...rule].map(([key, value]) => `${key}=${value}`).join(";");
}

/** "every week on Monday" for an RRULE without a start date. */
function textOf(rrule: string): string {
  try {
    return formatTasksMetadata({
      id: "",
      title: "",
      status: "todo",
      priority: "medium",
      tags: [],
      recurringInterval: rrule,
    }).replace(/^🔁️?\s*/u, "");
  } catch (error) {
    throw unfaithful(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Obsidian Tasks counts a text rule from the date it moves (due, else
 * scheduled, else start), so the repaired rule falls on the original's days
 * only when that date is on or after the start, and a whole number of the
 * rule's intervals after it.
 */
function checkCountsFromSameDay(
  freq: Frequency,
  interval: number,
  startDay: string,
  dates: NoteDates,
): void {
  const [label, anchor] = dates.dueAt
    ? ["due date", dates.dueAt]
    : dates.scheduledAt
      ? ["scheduled date", dates.scheduledAt]
      : ["start date", startDay];
  const day = anchor.slice(0, 10);
  if (day < startDay) {
    throw unfaithful(
      `its ${label} ${day} is before the rule's start date ${startDay}; the ` +
        `rule as text would count from ${day} and could fall on days before ${startDay}.`,
    );
  }
  const between = periodsBetween(freq, startDay, day);
  if (between % interval !== 0) {
    throw unfaithful(
      `it repeats every ${periods(interval, freq)} counted from its start ` +
        `date ${startDay}, but as text it would count from the ${label} ` +
        `${day}, ${periods(between, freq)} later, so it would fall on other days.`,
    );
  }
}

/** The parsed line without the parts the repair adds, for comparing. */
function comparable(task: Task): string {
  const { recurringInterval, isRecurring, startAt, extra, ...rest } = task;
  const { isTasksTask, ...otherExtra } = extra ?? {};
  return JSON.stringify({ ...rest, extra: otherExtra });
}

/**
 * The block body with the repaired rule in place of the 0.8 rule, checked by
 * reading it back: it must read as the rule and start date, with the rest of
 * the line (title, other fields, notes) read as before. The rule goes where
 * the 0.8 rule was when that reads back, else after the line's fields, so
 * text that followed the rule stays notes instead of joining the rule.
 */
function placeRule(
  legacy: LegacyMatch,
  text: string,
  startDay: string,
  hasStart: boolean,
): string {
  const stripped = joinAround(legacy.before, legacy.after);
  const want = comparable(parseLine(stripped));
  const readsBack = (body: string) => {
    const got = parseLine(body);
    return (
      got.recurringInterval === text &&
      got.startAt === startDay &&
      comparable(got) === want
    );
  };
  const fields = `${hasStart ? "" : `🛫 ${startDay} `}🔁 ${text}`;
  const inPlace = `${legacy.before}${fields}${legacy.after}`;
  if (readsBack(inPlace)) return inPlace;

  const cantKeep = `the text after it ("${legacy.after.trim()}") can't be kept next to the rule written as text`;
  let line: string;
  try {
    line = taskToMarkdown(
      { ...parseLine(stripped), recurringInterval: text, startAt: startDay },
      `- [ ] ${stripped}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw unfaithful(`${cantKeep}: ${reason}`);
  }
  const rewritten = line.startsWith("- [ ] ") ? line.slice(6).trimEnd() : "";
  if (rewritten && readsBack(rewritten)) return rewritten;
  throw unfaithful(`${cantKeep}.`);
}

function repairRule(legacy: LegacyMatch, dates?: NoteDates): string {
  if (WHEN_DONE.test(legacy.after)) {
    throw unfaithful(
      'it is followed by "when done", which would make the rule as text ' +
        "count from the day the task is done instead of from its start date.",
    );
  }
  const parts = readRuleParts(legacy.rrule);
  const freq = readFrequency(parts);
  const interval = readInterval(parts);
  const { start, tzid } = readStart(legacy.dtstart);
  const text = textOf(withoutStart(parts, freq, start, tzid));

  const own = datesOf(joinAround(legacy.before, legacy.after));
  const noteDates = dates ?? own;
  const existingStart = own.startAt ?? noteDates.startAt;
  if (existingStart && existingStart !== start.day) {
    throw unfaithful(
      `the note already has the start date 🛫 ${existingStart}, but the rule starts on ${start.day}.`,
    );
  }
  checkCountsFromSameDay(freq, interval, start.day, noteDates);
  return placeRule(legacy, text, start.day, own.startAt !== undefined);
}

/**
 * Moves the start date of a 0.8 rule to 🛫 and writes the rule as Obsidian
 * Tasks text: "🔁 DTSTART:20261016 RRULE:FREQ=WEEKLY" becomes
 * "🛫 2026-10-16 🔁 every week on Friday". `dates` are the note's dates
 * (both blocks), which say where the next occurrence counts from; without
 * them the block's own are used. Other text is returned unchanged.
 */
export function repairLegacyRecurrence(
  text: string,
  dates?: NoteDates,
): LegacyRecurrenceRepair {
  const checkbox = CHECKBOX_PREFIX.exec(text)?.[0] ?? "";
  const body = text.slice(checkbox.length);
  const legacy = findLegacyRule(body);
  if (!legacy) return { text };
  try {
    return { text: checkbox + repairRule(legacy, dates) };
  } catch (error) {
    if (!(error instanceof RepairRefused)) throw error;
    const message = manualFix(
      `${legacy.dtstart} ${legacy.rrule}`,
      error.reason,
    );
    return {
      text,
      error: message,
      unrepaired: {
        text: checkbox + joinAround(legacy.before, legacy.after),
        recurringInterval: error.readable
          ? `${legacy.dtstart}\n${legacy.rrule}`
          : message,
      },
    };
  }
}
