/**
 * Repair of rules Tasks Timeline 0.1 (components 0.8) wrote with a start
 * date ("🔁 DTSTART:… RRULE:…"). The repaired note must recur on the same
 * days as the original rule, keep the text after it, and a rule that can't
 * be repaired faithfully must stay marked so writes and completions fail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RRule } from "rrule";
import { createCapabilities } from "@tasks-timeline/components/capabilities";
import type { Task } from "@tasks-timeline/components";
import {
  DEFAULT_TASK_TAG,
  isMetadataBlock,
  noteToTask,
  planNewTaskNote,
  repairLegacyRecurrence,
  writeTaskBlocks,
} from "../src/tasks/noteFormat";

/** "DTSTART:…Z" for local midnight of a day, as v0.8.0's editor wrote it. */
function utcStartOf(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** "UNTIL=…Z" for the local end of a day, as v0.8.0's editor wrote it. */
function utcEndOf(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 23, 59, 59)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** A UTC time as the wall-clock time it is here, without the Z. */
function asLocalWallTime(value: string): string {
  const [, y, m, d, hh, mm, ss] =
    /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(value) ?? [];
  const date = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * The first `count` days after `after` that the original rule falls on,
 * stepped with rrule on floating days in the frame the library reads a
 * start in: floating and TZID wall-clock times and UTC midnight as written,
 * other UTC times (local midnight written by v0.8.0) as local wall-clock
 * times, and a UTC end in the start's frame.
 */
function originalRuleDays(
  dtstart: string,
  rrule: string,
  after: string,
  count: number,
): string[] {
  const local = /T\d{6}Z$/.test(dtstart) && !/T000000Z$/.test(dtstart);
  const toFrame = (part: string) =>
    local
      ? part.replace(/\d{8}T\d{6}Z/g, asLocalWallTime)
      : part.replace(/(T\d{6})Z/g, "$1");
  const rule = RRule.fromString(
    `${toFrame(dtstart.replace(/;TZID=[^:]+/, ""))}\n${toFrame(rrule)}`,
  );
  const endOfDay = (day: string) => new Date(`${day}T23:59:59Z`);
  const days: string[] = [];
  let from = after;
  while (days.length < count) {
    const next = rule.after(endOfDay(from));
    if (!next) break;
    from = utcDay(next);
    days.push(from);
  }
  return days;
}

type Context = Parameters<typeof createCapabilities>[0];

const baseContext = (tasks: () => Task[]) => ({
  getTasks: async () => tasks(),
  getTask: async (id: string) => tasks().find((t) => t.id === id) ?? null,
  deleteTask: async () => undefined,
  recurrenceFormat: "text" as const,
});

/** The due dates complete_task gives a plain task with this rule, in turn. */
async function libraryDays(
  rule: string,
  dueAt: string,
  count: number,
): Promise<string[]> {
  let task: Task = {
    id: "t",
    title: "Water plants",
    status: "todo",
    priority: "medium",
    tags: [],
    dueAt,
    isRecurring: true,
    recurringInterval: rule,
  };
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    let next: Task | null = null;
    const context: Context = {
      ...baseContext(() => [task]),
      addTask: async (added) => {
        next = { ...added, id: "t" };
        return next;
      },
      updateTask: async () => undefined,
    };
    const result = await createCapabilities(context).executeTool(
      "complete_task",
      { id: "t" },
    );
    expect(result.result).toMatchObject({ success: true });
    if (!next) break;
    task = next;
    days.push(String((next as Task).dueAt));
  }
  return days;
}

/**
 * Task notes in memory, read and written as the plugin does: noteToTask on
 * read, writeTaskBlocks on the current blocks for an edit, and a new note
 * from planNewTaskNote for a next occurrence.
 */
function noteLibrary(blocks: string[]) {
  const notes = new Map<string, string[]>([["NOTE0001", blocks]]);
  const read = (key: string) =>
    noteToTask(
      {
        libraryID: 1,
        libraryName: "My Library",
        editable: true,
        key,
        blocks: notes.get(key) ?? [],
        tags: [DEFAULT_TASK_TAG],
        dateAdded: "2026-10-01",
      },
      DEFAULT_TASK_TAG,
    );
  const tasks = () => [...notes.keys()].map(read);
  const keyOf = (task: Task) => task.id.split("/")[1];
  const context: Context = {
    ...baseContext(tasks),
    addTask: async (task) => {
      const written = writeTaskBlocks(planNewTaskNote(task).task);
      const key = `NOTE${pad(notes.size + 1).padStart(4, "0")}`;
      notes.set(key, [written.title, written.metadataLine]);
      return read(key);
    },
    updateTask: async (task) => {
      const key = keyOf(task);
      const [title = "", second, ...rest] = notes.get(key) ?? [];
      const hasMetadata = second !== undefined && isMetadataBlock(second);
      const written = writeTaskBlocks(task, {
        title,
        metadata: hasMetadata ? second : undefined,
      });
      notes.set(key, [
        written.title,
        written.metadataLine,
        ...(hasMetadata ? rest : [second, ...rest]),
      ]);
    },
  };
  const capabilities = createCapabilities(context);
  const complete = (task: Task) =>
    capabilities.executeTool("complete_task", { id: task.id });
  return { notes, read, tasks, complete };
}

/** Completes the note's task `count` times in turn; the new due dates. */
async function completedDueDates(
  blocks: string[],
  count: number,
): Promise<string[]> {
  const library = noteLibrary(blocks);
  let task = library.read("NOTE0001");
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const before = library.notes.size;
    const result = await library.complete(task);
    expect(result.result).toMatchObject({ success: true });
    if (library.notes.size === before) break;
    task = library.tasks()[library.notes.size - 1];
    days.push(String(task.dueAt));
  }
  return days;
}

const FRAMES: [string, string][] = [
  ["a UTC start (local midnight)", `DTSTART:${utcStartOf(2026, 10, 16)}`],
  ["a floating start", "DTSTART:20261016T000000"],
  ["a TZID start", "DTSTART;TZID=America/New_York:20261016T090000"],
];

/** Rules starting Friday 2026-10-16, with a due date on or after it. */
const RULES: { rrule: string; due: string; text: string }[] = [
  // The day comes from DTSTART
  {
    rrule: "RRULE:FREQ=WEEKLY;INTERVAL=1",
    due: "2026-10-20",
    text: "every week on Friday",
  },
  {
    rrule: "RRULE:FREQ=WEEKLY;INTERVAL=2",
    due: "2026-10-27",
    text: "every 2 weeks on Friday",
  },
  {
    rrule: "RRULE:FREQ=MONTHLY",
    due: "2026-10-20",
    text: "every month on the 16th",
  },
  {
    rrule: "RRULE:FREQ=MONTHLY;INTERVAL=2",
    due: "2026-12-20",
    text: "every 2 months on the 16th",
  },
  {
    rrule: "RRULE:FREQ=YEARLY",
    due: "2026-10-20",
    text: "every October on the 16th",
  },
  {
    rrule: "RRULE:FREQ=YEARLY;BYMONTH=3",
    due: "2026-10-20",
    text: "every March on the 16th",
  },
  // The day is in the rule
  {
    rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    due: "2026-10-20",
    text: "every week on Monday, Wednesday",
  },
  {
    rrule: "RRULE:FREQ=MONTHLY;BYDAY=+2MO",
    due: "2026-10-20",
    text: "every month on the 2nd Monday",
  },
  {
    rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=1",
    due: "2026-10-20",
    text: "every month on the 1st",
  },
  {
    rrule: "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
    due: "2026-10-20",
    text: "every March on the 1st",
  },
  { rrule: "RRULE:FREQ=DAILY", due: "2026-10-20", text: "every day" },
  {
    rrule: "RRULE:FREQ=WEEKLY;UNTIL=20261130",
    due: "2026-10-20",
    text: "every week on Friday until November 30, 2026",
  },
];

describe.each(FRAMES)(
  "repaired rules recur on the same days (%s)",
  (_, dtstart) => {
    it.each(RULES)("$rrule", async ({ rrule, due, text }) => {
      const blocks = ["Water plants", `[ ] 📅 ${due} 🔁 ${dtstart} ${rrule}`];
      const task = noteToTask(
        {
          libraryID: 1,
          libraryName: "My Library",
          editable: true,
          key: "NOTE0001",
          blocks,
          tags: [DEFAULT_TASK_TAG],
          dateAdded: "2026-10-01",
        },
        DEFAULT_TASK_TAG,
      );
      expect(task).toMatchObject({ startAt: "2026-10-16", isRecurring: true });
      expect(task.recurringInterval).toBe(text);
      expect(task.extra?.legacyRecurrenceError).toBeUndefined();

      const expected = originalRuleDays(dtstart, rrule, due, 6);
      expect(expected.length).toBeGreaterThan(0);
      // The oracle agrees with the library reading the original rule
      expect(await libraryDays(`${dtstart}\n${rrule}`, due, 6)).toEqual(
        expected,
      );
      expect(await completedDueDates(blocks, 6)).toEqual(expected);
    });
  },
);

describe("repaired end dates", () => {
  it("keeps the last day of a UTC end date v0.8.0 wrote at local end of day", async () => {
    const dtstart = `DTSTART:${utcStartOf(2026, 10, 16)}`;
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${utcEndOf(2026, 11, 27)}`;
    const blocks = ["Water plants", `[ ] 📅 2026-10-20 🔁 ${dtstart} ${rrule}`];
    expect(repairLegacyRecurrence(blocks[1])).toEqual({
      text: "[ ] 📅 2026-10-20 🛫 2026-10-16 🔁 every week on Friday until November 27, 2026",
    });
    const expected = originalRuleDays(dtstart, rrule, "2026-10-20", 10);
    expect(expected.at(-1)).toBe("2026-11-27");
    expect(await completedDueDates(blocks, 10)).toEqual(expected);
  });
});

describe("a UTC midnight start is read as written", () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    // Assigning undefined would set the zone named "undefined"
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("keeps the day in a zone west of UTC", async () => {
    const dtstart = "DTSTART:20261016T000000Z";
    const rrule = "RRULE:FREQ=WEEKLY";
    const blocks = ["Water plants", `[ ] 📅 2026-10-20 🔁 ${dtstart} ${rrule}`];
    expect(repairLegacyRecurrence(blocks[1])).toEqual({
      text: "[ ] 📅 2026-10-20 🛫 2026-10-16 🔁 every week on Friday",
    });
    const expected = originalRuleDays(dtstart, rrule, "2026-10-20", 4);
    expect(await libraryDays(`${dtstart}\n${rrule}`, "2026-10-20", 4)).toEqual(
      expected,
    );
    expect(await completedDueDates(blocks, 4)).toEqual(expected);
  });
});

describe("text after a 0.8.0 rule", () => {
  const start = `DTSTART:${utcStartOf(2026, 10, 16)}`;
  const line = `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=WEEKLY;BYDAY=MO see notes.`;

  it("is kept as notes, and the rule still reads back", () => {
    const repair = repairLegacyRecurrence(line);
    expect(repair.error).toBeUndefined();
    const task = noteToTask(
      {
        libraryID: 1,
        libraryName: "My Library",
        editable: true,
        key: "NOTE0001",
        blocks: ["Water plants", repair.text],
        tags: [DEFAULT_TASK_TAG],
        dateAdded: "2026-10-01",
      },
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({
      startAt: "2026-10-16",
      dueAt: "2026-10-20",
      isRecurring: true,
      recurringInterval: "every week on Monday",
    });
    expect(task.extra?.lineNotes).toBe("see notes.");
  });

  it("survives an edit and a completion", async () => {
    const library = noteLibrary(["Water plants", line]);
    const task = library.read("NOTE0001");
    expect(task.recurringInterval).toBe("every week on Monday");
    expect(task.extra?.lineNotes).toBe("see notes.");

    const written = writeTaskBlocks(
      { ...task, priority: "high" },
      { title: "Water plants", metadata: line },
    );
    const reread = noteToTask(
      {
        libraryID: 1,
        libraryName: "My Library",
        editable: true,
        key: "NOTE0001",
        blocks: [written.title, written.metadataLine],
        tags: [DEFAULT_TASK_TAG],
        dateAdded: "2026-10-01",
      },
      DEFAULT_TASK_TAG,
    );
    expect(reread).toMatchObject({
      priority: "high",
      recurringInterval: "every week on Monday",
      startAt: "2026-10-16",
    });
    expect(reread.extra?.lineNotes).toBe("see notes.");

    expect(await completedDueDates(["Water plants", line], 2)).toEqual([
      "2026-10-26",
      "2026-11-02",
    ]);
  });

  it("keeps a link after the rule", () => {
    const task = noteToTask(
      {
        libraryID: 1,
        libraryName: "My Library",
        editable: true,
        key: "NOTE0001",
        blocks: [
          "Water plants",
          `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=WEEKLY see [[Garden]]`,
        ],
        tags: [DEFAULT_TASK_TAG],
        dateAdded: "2026-10-01",
      },
      DEFAULT_TASK_TAG,
    );
    expect(task.recurringInterval).toBe("every week on Friday");
    expect(task.extra?.lineNotes).toBe("see [[Garden]]");
  });
});

/**
 * A rule that can't be repaired faithfully: the task still reads as
 * recurring and marked, and every write and completion fails with the
 * message about fixing the Zotero note, leaving the note unchanged.
 */
async function expectRefused(blocks: string[], reason: RegExp) {
  const repair = repairLegacyRecurrence(blocks[1]);
  expect(repair.text).toBe(blocks[1]);
  expect(repair.error).toMatch(/Zotero/);
  expect(repair.error).toMatch(reason);

  const library = noteLibrary(blocks);
  const task = library.read("NOTE0001");
  expect(task.isRecurring).toBe(true);
  expect(task.recurringInterval).toBeTruthy();
  expect(task.extra?.legacyRecurrenceError).toBe(repair.error);

  expect(() =>
    writeTaskBlocks(
      { ...task, priority: "high" },
      { title: blocks[0], metadata: blocks[1] },
    ),
  ).toThrow(/Zotero/);
  const result = (await library.complete(task)).result as Record<
    string,
    unknown
  >;
  expect(result.success).not.toBe(true);
  expect(String(result.error)).toMatch(/Zotero/);
  expect(library.notes.size).toBe(1);
  expect(library.notes.get("NOTE0001")).toEqual(blocks);
}

describe("rules that can't be repaired faithfully", () => {
  const start = "DTSTART:20261016T000000";

  it("refuses a COUNT rule, which would never end in one note per occurrence", async () => {
    await expectRefused(
      [
        "Water plants",
        `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=WEEKLY;COUNT=5`,
      ],
      /COUNT=5/,
    );
  });

  it("refuses every 2 weeks when the due date is outside the rule's weeks", async () => {
    // Weeks counted from Fri 2026-10-16; Obsidian Tasks counts from the due date
    await expectRefused(
      [
        "Water plants",
        `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=WEEKLY;INTERVAL=2`,
      ],
      /2026-10-20/,
    );
  });

  it("refuses a rule whose due date is before its start date", async () => {
    await expectRefused(
      [
        "Water plants",
        `[ ] 📅 2026-10-12 🔁 ${start} RRULE:FREQ=WEEKLY;BYDAY=MO`,
      ],
      /2026-10-12/,
    );
  });

  it("refuses a rule followed by when done", async () => {
    await expectRefused(
      [
        "Water plants",
        `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=WEEKLY when done`,
      ],
      /when done/,
    );
  });

  it("refuses parts a text rule can't hold", async () => {
    await expectRefused(
      [
        "Water plants",
        `[ ] 📅 2026-10-20 🔁 ${start} RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1`,
      ],
      /BYSETPOS/,
    );
  });

  it("refuses a rule with a different 🛫 date", async () => {
    await expectRefused(
      ["Water plants", `[ ] 🛫 2026-10-01 🔁 ${start} RRULE:FREQ=DAILY`],
      /🛫 2026-10-01/,
    );
  });

  it("refuses a rule the library can't read", async () => {
    await expectRefused(
      ["Water plants", `[ ] 📅 2026-10-20 🔁 ${start} RRULE:INTERVAL=2`],
      /FREQ/,
    );
  });

  it("refuses a start date that can't be read", async () => {
    await expectRefused(
      [
        "Water plants",
        "[ ] 📅 2026-10-20 🔁 DTSTART:20261316 RRULE:FREQ=DAILY",
      ],
      /DTSTART:20261316/,
    );
  });
});
