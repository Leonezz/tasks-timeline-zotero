/**
 * Repairs recurrence rules that Tasks Timeline 0.1 (with
 * @tasks-timeline/components 0.8) wrote with a start date. They were saved as
 * "🔁 DTSTART:… RRULE:…" in one block, which an Obsidian Tasks line can't
 * hold, so every edit of such a note failed. Pure: runs under Node unit tests.
 */
import { formatTasksMetadata } from "@tasks-timeline/components/tasks-format";

export interface LegacyRecurrenceRepair {
  /** The repaired block text, or the block unchanged when it can't be repaired. */
  text: string;
  /** Why the block can't be repaired and how to fix the note by hand. */
  error?: string;
}

// The characters of an RRULE, and "_" for time zones such as Buenos_Aires.
const RULE_CHARS = "[A-Za-z0-9=;:,+_\\-/]";
/** "🔁 DTSTART:… RRULE:…", the two parts separated by whitespace or glued. */
const LEGACY_RULE = new RegExp(
  `🔁\\uFE0F? *(DTSTART[;:=]${RULE_CHARS}*?)\\s*(RRULE:${RULE_CHARS}+)`,
  "u",
);
/** "DTSTART:…", "DTSTART;TZID=…:…", "DTSTART;VALUE=DATE:…" or "DTSTART=…". */
const START_DATE =
  /^DTSTART(?:(?:;[^:]*)?:|=)(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})(Z)?)?$/i;
const START_FIELD = /🛫️? *(\d{4}-\d{2}-\d{2})/u;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The calendar day a 0.8 start date stands for. The 0.8 editor wrote local
 * midnight as UTC ("DTSTART:20261015T160000Z" for Oct 16 in UTC+8), so UTC
 * times are read in local time; floating and TZID dates are read as written.
 */
function startDay(dtstart: string): string | null {
  const match = START_DATE.exec(dtstart);
  if (!match) return null;
  const [, y, m, d, hh = "0", mm = "0", ss = "0", utc] = match;
  const date = utc
    ? new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss))
    : new Date(+y, +m - 1, +d);
  if (!utc && (date.getMonth() !== +m - 1 || date.getDate() !== +d)) {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : isoDay(date);
}

/** "🔁 every week on Monday" for an RRULE without a start date. */
function ruleField(rrule: string): string {
  return formatTasksMetadata({
    id: "",
    title: "",
    status: "todo",
    priority: "medium",
    tags: [],
    recurringInterval: rrule,
  });
}

function manualFix(legacy: string, reason: string): string {
  return (
    `This task's recurrence "🔁 ${legacy}" was saved by an earlier version ` +
    "of Tasks Timeline with a start date, which a task note can't hold, and " +
    `it can't be repaired automatically: ${reason} To fix it, open the ` +
    `task's note in Zotero and replace "🔁 ${legacy}" with the rule as text, ` +
    'such as "🔁 every week", and put the start date after 🛫.'
  );
}

/**
 * Moves the start date of a 0.8 rule to 🛫 and writes the rule as Obsidian
 * Tasks text: "🔁 DTSTART:20261016 RRULE:FREQ=WEEKLY;BYDAY=MO" becomes
 * "🛫 2026-10-16 🔁 every week on Monday". Other text is returned unchanged.
 */
export function repairLegacyRecurrence(text: string): LegacyRecurrenceRepair {
  const match = LEGACY_RULE.exec(text);
  if (!match) return { text };
  const [span, dtstart, rrule] = match;
  const legacy = `${dtstart} ${rrule}`;
  const day = startDay(dtstart);
  if (!day) {
    return {
      text,
      error: manualFix(legacy, `its start date "${dtstart}" can't be read.`),
    };
  }
  const existingStart = START_FIELD.exec(text)?.[1];
  if (existingStart && existingStart !== day) {
    return {
      text,
      error: manualFix(
        legacy,
        `the note already has the start date 🛫 ${existingStart}, but the rule starts on ${day}.`,
      ),
    };
  }
  let rule: string;
  try {
    rule = ruleField(rrule);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { text, error: manualFix(legacy, reason) };
  }
  const replacement = existingStart ? rule : `🛫 ${day} ${rule}`;
  return {
    text:
      text.slice(0, match.index) +
      replacement +
      text.slice(match.index + span.length),
  };
}
