import { describe, expect, it } from "vitest";
import type { Task } from "@tasks-timeline/components";
import {
  DEFAULT_TASK_TAG,
  isMetadataBlock,
  metadataLineFor,
  noteToTask,
  parseTaskId,
  planNewTaskNote,
  repairLegacyRecurrence,
  taskIdFor,
  writeTaskBlocks,
} from "../src/tasks/noteFormat";
import type { TaskNoteSource } from "../src/tasks/noteFormat";

function source(overrides: Partial<TaskNoteSource>): TaskNoteSource {
  return {
    libraryID: 1,
    libraryName: "My Library",
    editable: true,
    key: "ABCD1234",
    blocks: ["Read Attention paper"],
    tags: [DEFAULT_TASK_TAG],
    dateAdded: "2026-10-01",
    ...overrides,
  };
}

describe("taskIdFor / parseTaskId", () => {
  it("round-trips library and key", () => {
    const id = taskIdFor(12, "ABCD1234");
    expect(id).toBe("12/ABCD1234");
    expect(parseTaskId(id)).toEqual({ libraryID: 12, key: "ABCD1234" });
  });

  it("rejects malformed ids", () => {
    expect(() => parseTaskId("ABCD1234")).toThrow(/Malformed/);
  });
});

describe("noteToTask", () => {
  it("maps a title-only note to an open task", () => {
    const task = noteToTask(source({}), DEFAULT_TASK_TAG);
    expect(task).toMatchObject({
      id: "1/ABCD1234",
      title: "Read Attention paper",
      status: "todo",
      priority: "medium",
      createdAt: "2026-10-01",
      category: "My Library",
      tags: [],
    });
    expect(task.description).toBeUndefined();
    expect(task.extra).toMatchObject({
      libraryID: "1",
      noteKey: "ABCD1234",
      editable: "true",
    });
  });

  it("reads the metadata line with a checkbox marker", () => {
    const task = noteToTask(
      source({
        blocks: [
          "Read Attention paper",
          "[x] ⏫ 📅 2026-10-20 🛫 2026-10-15 ✅ 2026-10-18",
          "Focus on section 3.",
        ],
      }),
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({
      title: "Read Attention paper",
      status: "done",
      priority: "high",
      dueAt: "2026-10-20",
      startAt: "2026-10-15",
      completedAt: "2026-10-18",
      description: "Focus on section 3.",
    });
  });

  it("maps checkbox markers to statuses", () => {
    const status = (marker: string) =>
      noteToTask(
        source({ blocks: ["T", `[${marker}] 📅 2026-10-20`] }),
        DEFAULT_TASK_TAG,
      ).status;
    expect(status(" ")).toBe("todo");
    expect(status("/")).toBe("doing");
    expect(status("-")).toBe("cancelled");
    expect(status("x")).toBe("done");
  });

  it("accepts a metadata line without a checkbox", () => {
    const task = noteToTask(
      source({ blocks: ["Title", "📅 2026-10-20 🔽"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({ dueAt: "2026-10-20", priority: "low" });
    expect(task.description).toBeUndefined();
  });

  it("treats a prose second block as description", () => {
    const task = noteToTask(
      source({ blocks: ["Title", "Due before the 📅 2026-10-20 meeting"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.dueAt).toBeUndefined();
    expect(task.description).toBe("Due before the 📅 2026-10-20 meeting");
  });

  it("reads metadata typed into the title line", () => {
    const task = noteToTask(
      source({ blocks: ["Write review 📅 2026-11-01"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({ title: "Write review", dueAt: "2026-11-01" });
  });

  it("lets the metadata line win over the title line", () => {
    const task = noteToTask(
      source({ blocks: ["Write review 📅 2026-11-01", "[ ] 📅 2026-11-05"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.dueAt).toBe("2026-11-05");
  });

  it("marks a task done when it has a completion date but no marker", () => {
    const task = noteToTask(
      source({ blocks: ["Title", "✅ 2026-10-18"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.status).toBe("done");
  });

  it("prefers ➕ over the note's dateAdded", () => {
    const task = noteToTask(
      source({ blocks: ["Title", "➕ 2026-09-01"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.createdAt).toBe("2026-09-01");
  });

  it("keeps scheduled date and recurrence", () => {
    const task = noteToTask(
      source({ blocks: ["Title", "[ ] ⏳ 2026-10-21 🔁 every week"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.extra?.scheduledAt).toBe("2026-10-21");
    expect(task).toMatchObject({
      isRecurring: true,
      recurringInterval: "every week",
    });
  });

  it("drops the task tag and keeps the other tags", () => {
    const task = noteToTask(
      source({ tags: [DEFAULT_TASK_TAG, "reading", "thesis"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.tags.map((t) => t.name)).toEqual(["reading", "thesis"]);
  });

  it("records the parent item and read-only libraries", () => {
    const task = noteToTask(
      source({
        libraryName: "Lab Group",
        editable: false,
        parent: { key: "PARENT01", title: "Attention Is All You Need" },
      }),
      DEFAULT_TASK_TAG,
    );
    expect(task.category).toBe("Lab Group");
    expect(task.extra).toMatchObject({
      editable: "false",
      parentKey: "PARENT01",
      parentTitle: "Attention Is All You Need",
    });
  });
});

describe("metadataLineFor", () => {
  const read = (blocks: string[]) =>
    noteToTask(source({ blocks }), DEFAULT_TASK_TAG);

  it("writes the status marker even without other metadata", () => {
    expect(metadataLineFor(read(["T"]))).toBe("[ ]");
  });

  it("writes priority and dates in Tasks order", () => {
    const task = {
      ...read(["T"]),
      status: "done" as const,
      priority: "high" as const,
      dueAt: "2026-10-20",
      startAt: "2026-10-15",
      completedAt: "2026-10-18T09:30:00.000+08:00",
    };
    expect(metadataLineFor(task)).toBe(
      "[x] ⏫ 📅 2026-10-20 🛫 2026-10-15 ✅ 2026-10-18",
    );
  });

  it("does not write ➕ when created date is just the note's dateAdded", () => {
    const task = read(["T", "[ ] 📅 2026-10-20"]);
    expect(task.createdAt).toBe("2026-10-01");
    expect(metadataLineFor(task)).toBe("[ ] 📅 2026-10-20");
  });

  it("keeps ➕ the note already had", () => {
    const task = read(["T", "[ ] ➕ 2026-09-01"]);
    expect(metadataLineFor(task)).toBe("[ ] ➕ 2026-09-01");
  });

  it("writes ➕ when the created date was changed", () => {
    const task = { ...read(["T"]), createdAt: "2026-09-15" };
    expect(metadataLineFor(task)).toBe("[ ] ➕ 2026-09-15");
  });

  it("omits ➕ for brand new tasks", () => {
    const task = { ...read(["T"]), createdAt: "2026-10-13", extra: undefined };
    expect(metadataLineFor(task)).toBe("[ ]");
  });

  it("round-trips through noteToTask", () => {
    const original = read([
      "T",
      "[/] 🔽 📅 2026-10-20 ⏳ 2026-10-19 🔁 every week",
    ]);
    const line = metadataLineFor(original);
    expect(isMetadataBlock(line)).toBe(true);
    const reread = read(["T", line]);
    expect(reread).toMatchObject({
      status: "doing",
      priority: "low",
      dueAt: "2026-10-20",
      recurringInterval: "every week",
    });
    expect(reread.extra?.scheduledAt).toBe("2026-10-19");
  });
});

/** Reads a note, applies an edit, and returns the blocks written back. */
function edit(blocks: string[], change: (task: Task) => Task = (t) => t) {
  const task = noteToTask(source({ blocks }), DEFAULT_TASK_TAG);
  const [title = "", second] = blocks;
  const metadata =
    second !== undefined && isMetadataBlock(second) ? second : undefined;
  return writeTaskBlocks(change(task), { title, metadata });
}

describe("noteToTask reads every Obsidian Tasks field", () => {
  it("reads ❌ 🏁 🆔 ⛔ from the metadata line", () => {
    const task = noteToTask(
      source({
        blocks: [
          "T",
          "[-] 📅 2026-10-20 ❌ 2026-10-17 🏁 delete 🆔 abc ⛔ xyz,uvw",
        ],
      }),
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({
      status: "cancelled",
      dueAt: "2026-10-20",
      cancelledAt: "2026-10-17",
      onCompletion: "delete",
      taskId: "abc",
      dependsOn: ["xyz", "uvw"],
    });
  });

  it("keeps notes after the fields out of the title", () => {
    const task = noteToTask(
      source({ blocks: ["Read paper 📅 2026-10-20 see [[Garden]]"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.title).toBe("Read paper");
    expect(task.extra?.lineNotes).toBe("see [[Garden]]");
  });

  it("keeps ⏰ reminders and block ids out of the title", () => {
    const task = noteToTask(
      source({ blocks: ["Call mom ⏰ 2026-10-16 09:00 about birthday ^blk1"] }),
      DEFAULT_TASK_TAG,
    );
    expect(task.title).toBe("Call mom about birthday");
  });

  it("collects text on the metadata line as notes", () => {
    const task = noteToTask(
      source({
        blocks: ["T 📅 2026-10-20 a", "[ ] 🔽 📅 2026-10-21 see [[Garden]]"],
      }),
      DEFAULT_TASK_TAG,
    );
    expect(task.extra?.lineNotes).toBe("a see [[Garden]]");
  });
});

describe("writeTaskBlocks round trips", () => {
  const unchanged = [
    ["Read paper 📅 2026-10-20 see [[Garden]]"],
    ["T", "[ ] 📅 2026-10-20 🆔 abc ⛔ xyz 🏁 delete"],
    ["T", "[-] 📅 2026-10-20 ❌ 2026-10-17"],
    ["Call mom ⏰ 2026-10-16 09:00 about birthday", "[ ] 📅 2026-10-16"],
    ["Water plants ^blk1", "[ ] 📅 2026-10-16"],
    ["Water plants", "[ ] 🔁 every week📅 2026-10-16"],
    ["Water plants 🔁 every day at 9:30", "[/] ⏳ 2026-10-16"],
    ["T", "[x] 🔽 📅 2026-10-20 ✅ 2026-10-18 see [[Garden]]"],
    ["T", "[ ] 📆 2026-10-20 ⏫"],
    ["Pay rent #home 📅 2026-10-01", "[ ] 🛫 2026-09-28"],
  ];
  for (const blocks of unchanged) {
    it(`writes ${JSON.stringify(blocks)} back byte for byte`, () => {
      const written = edit(blocks);
      expect(written.title).toBe(blocks[0]);
      expect(written.metadataLine).toBe(blocks[1] ?? "[ ]");
    });
  }

  it("keeps notes after the fields of the title when the date changes", () => {
    const written = edit(["Read paper 📅 2026-10-20 see [[Garden]]"], (t) => ({
      ...t,
      dueAt: "2026-10-25",
    }));
    expect(written).toEqual({
      title: "Read paper 📅 2026-10-25 see [[Garden]]",
      metadataLine: "[ ]",
    });
  });

  it("keeps 🆔 ⛔ 🏁 when a task is completed", () => {
    const written = edit(
      ["T", "[ ] 📅 2026-10-20 🆔 abc ⛔ xyz 🏁 delete"],
      (t) => ({ ...t, status: "done", completedAt: "2026-10-18T09:00:00Z" }),
    );
    expect(written.title).toBe("T");
    expect(written.metadataLine).toMatch(/^\[x\] 📅 2026-10-20 /);
    for (const kept of ["🆔 abc", "⛔ xyz", "🏁 delete", "✅ 2026-10-18"]) {
      expect(written.metadataLine).toContain(kept);
    }
  });

  it("writes the ❌ date of a cancelled task", () => {
    const written = edit(["T", "[ ] 📅 2026-10-20"], (t) => ({
      ...t,
      status: "cancelled",
      cancelledAt: "2026-10-17T10:00:00+08:00",
    }));
    expect(written.metadataLine).toBe("[-] 📅 2026-10-20 ❌ 2026-10-17");
  });

  it("keeps the ⏰ reminder and block id when the title changes", () => {
    const written = edit(
      [
        "Call mom ⏰ 2026-10-16 09:00 about birthday ^blk1",
        "[ ] 📅 2026-10-16",
      ],
      (t) => ({ ...t, title: "Call dad about birthday" }),
    );
    expect(written.title).toContain("Call dad about birthday");
    expect(written.title).toContain("⏰ 2026-10-16 09:00");
    expect(written.title).toMatch(/ \^blk1$/);
    expect(written.metadataLine).toBe("[ ] 📅 2026-10-16");
  });

  it("keeps text written on the metadata line", () => {
    const written = edit(["T", "[ ] 📅 2026-10-20 see [[Garden]]"], (t) => ({
      ...t,
      dueAt: "2026-10-21",
    }));
    expect(written.metadataLine).toBe("[ ] 📅 2026-10-21 see [[Garden]]");
  });

  it("keeps a rule glued to the next field and text glued to a rule", () => {
    const written = edit(
      ["Water plants 🔁 every day at 9:30", "[ ] 🔁 every week📅 2026-10-16"],
      (t) => ({ ...t, priority: "high" }),
    );
    expect(written.title).toBe("Water plants 🔁 every day at 9:30");
    expect(written.metadataLine).toContain("🔁 every week📅 2026-10-16");
    expect(written.metadataLine).toContain("⏫");
  });

  it("leaves the title block alone when only the metadata changes", () => {
    const written = edit(
      ["Read paper 📅 2026-10-20 see [[Garden]]", "[ ] ⏫"],
      (t) => ({ ...t, priority: "low" }),
    );
    expect(written).toEqual({
      title: "Read paper 📅 2026-10-20 see [[Garden]]",
      metadataLine: "[ ] 🔽",
    });
  });

  it("leaves the metadata block alone when only the title changes", () => {
    const written = edit(
      ["Old 📅 2026-10-20", "[ ] ⏫ 🆔 abc see [[Garden]]"],
      (t) => ({ ...t, title: "New" }),
    );
    expect(written).toEqual({
      title: "New 📅 2026-10-20",
      metadataLine: "[ ] ⏫ 🆔 abc see [[Garden]]",
    });
  });

  it("adds new fields to the metadata line", () => {
    const written = edit(["Read paper"], (t) => ({
      ...t,
      priority: "high",
      dueAt: "2026-10-20",
    }));
    expect(written).toEqual({
      title: "Read paper",
      metadataLine: "[ ] ⏫ 📅 2026-10-20",
    });
  });

  it("removes a date from both blocks when the metadata line overrides it", () => {
    const written = edit(["T 📅 2026-10-01", "[ ] 📅 2026-10-05"], (t) => ({
      ...t,
      dueAt: undefined,
    }));
    expect(written).toEqual({ title: "T", metadataLine: "[ ]" });
  });

  it("never writes Zotero tags onto the note's lines", () => {
    const written = edit(["T", "[ ] 📅 2026-10-20"], (t) => ({
      ...t,
      tags: [{ id: "reading", name: "reading" }],
    }));
    expect(written).toEqual({ title: "T", metadataLine: "[ ] 📅 2026-10-20" });
  });

  it("re-reads as the edited task", () => {
    const blocks = ["Read paper 📅 2026-10-20 see [[Garden]]", "[ ] 🆔 abc"];
    const written = edit(blocks, (t) => ({
      ...t,
      title: "Read the paper",
      status: "done",
      completedAt: "2026-10-18",
    }));
    const reread = noteToTask(
      source({ blocks: [written.title, written.metadataLine] }),
      DEFAULT_TASK_TAG,
    );
    expect(reread).toMatchObject({
      title: "Read the paper",
      status: "done",
      dueAt: "2026-10-20",
      completedAt: "2026-10-18",
      taskId: "abc",
    });
    expect(reread.extra?.lineNotes).toBe("see [[Garden]]");
  });

  it("rejects a value a note's line can't hold", () => {
    expect(() =>
      edit(["T", "[ ]"], (t) => ({ ...t, taskId: "has space" })),
    ).toThrow(/task id/);
  });
});

/** "DTSTART:…Z" for local midnight of a day, as v0.8.0's editor wrote it. */
function utcStartOf(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

describe("repairLegacyRecurrence (rules v0.8.0 wrote with a start date)", () => {
  const start = utcStartOf(2026, 10, 16);

  it("moves the start date to 🛫 and writes the rule as text", () => {
    expect(
      repairLegacyRecurrence(
        `[ ] 📅 2026-10-20 🔁 DTSTART:${start} RRULE:FREQ=WEEKLY;BYDAY=MO`,
      ),
    ).toEqual({
      text: "[ ] 📅 2026-10-20 🛫 2026-10-16 🔁 every week on Monday",
    });
  });

  it("repairs a rule whose two parts were glued together", () => {
    expect(
      repairLegacyRecurrence(
        `[ ] 🔁 DTSTART:${start}RRULE:FREQ=WEEKLY;INTERVAL=2 ⏫`,
      ),
    ).toEqual({ text: "[ ] 🛫 2026-10-16 🔁 every 2 weeks ⏫" });
  });

  it("reads a floating start date as written", () => {
    expect(
      repairLegacyRecurrence("[ ] 🔁 DTSTART:20261016T000000 RRULE:FREQ=DAILY"),
    ).toEqual({ text: "[ ] 🛫 2026-10-16 🔁 every day" });
  });

  it("reads a start date with a time zone in that zone", () => {
    expect(
      repairLegacyRecurrence(
        "[ ] 🔁 DTSTART;TZID=America/Argentina/Buenos_Aires:20261016T090000 RRULE:FREQ=DAILY",
      ),
    ).toEqual({ text: "[ ] 🛫 2026-10-16 🔁 every day" });
  });

  it("keeps a 🛫 date that matches the start date", () => {
    expect(
      repairLegacyRecurrence(
        `[ ] 🛫 2026-10-16 🔁 DTSTART:${start} RRULE:FREQ=DAILY`,
      ),
    ).toEqual({ text: "[ ] 🛫 2026-10-16 🔁 every day" });
  });

  it("leaves other lines untouched", () => {
    for (const line of [
      "[ ] 🔁 every week",
      "[ ] 🔁 RRULE:FREQ=WEEKLY;BYDAY=MO",
      "Read paper",
    ]) {
      expect(repairLegacyRecurrence(line)).toEqual({ text: line });
    }
  });

  it("explains how to fix it in Zotero when the 🛫 date differs", () => {
    const line = `[ ] 🛫 2026-10-01 🔁 DTSTART:${start} RRULE:FREQ=DAILY`;
    const result = repairLegacyRecurrence(line);
    expect(result.text).toBe(line);
    expect(result.error).toMatch(/Zotero/);
    expect(result.error).toMatch(/🛫 2026-10-01/);
    expect(result.error).not.toMatch(/line below/);
  });

  it("explains how to fix it in Zotero when the rule is unreadable", () => {
    const result = repairLegacyRecurrence(
      `[ ] 🔁 DTSTART:${start} RRULE:INTERVAL=2`,
    );
    expect(result.error).toMatch(/note/);
    expect(result.error).not.toMatch(/line below/);
  });

  it("gives noteToTask the repaired rule and start date", () => {
    const task = noteToTask(
      source({
        blocks: [
          "Water plants",
          `[ ] 📅 2026-10-20 🔁 DTSTART:${start} RRULE:FREQ=WEEKLY;BYDAY=MO`,
        ],
      }),
      DEFAULT_TASK_TAG,
    );
    expect(task).toMatchObject({
      title: "Water plants",
      startAt: "2026-10-16",
      dueAt: "2026-10-20",
      isRecurring: true,
      recurringInterval: "every week on Monday",
    });
    expect(task.extra?.lineNotes).toBeUndefined();
  });

  it("writes the repaired line on the next edit", () => {
    const written = edit(
      [
        "Water plants",
        `[ ] 📅 2026-10-20 🔁 DTSTART:${start} RRULE:FREQ=WEEKLY;BYDAY=MO`,
      ],
      (t) => ({ ...t, status: "done", completedAt: "2026-10-18" }),
    );
    expect(written.metadataLine).toBe(
      "[x] 📅 2026-10-20 🛫 2026-10-16 🔁 every week on Monday ✅ 2026-10-18",
    );
  });

  it("refuses the edit with the Zotero repair message when it can't repair", () => {
    const blocks = [
      "Water plants",
      `[ ] 🛫 2026-10-01 🔁 DTSTART:${start} RRULE:FREQ=DAILY`,
    ];
    expect(() =>
      noteToTask(source({ blocks }), DEFAULT_TASK_TAG),
    ).not.toThrow();
    expect(() => edit(blocks, (t) => ({ ...t, priority: "high" }))).toThrow(
      /Zotero/,
    );
  });
});

describe("planNewTaskNote", () => {
  it("puts a task from the timeline in My Library", () => {
    const task: Task = {
      id: "new-1",
      title: "Brand new",
      status: "todo",
      priority: "medium",
      tags: [],
      createdAt: "2026-10-18T10:00:00+08:00",
    };
    const plan = planNewTaskNote(task);
    expect(plan.libraryID).toBeUndefined();
    expect(plan.parentKey).toBeUndefined();
    expect(metadataLineFor(plan.task)).toBe("[ ]");
  });

  it("keeps the next occurrence's library, parent, ⏳ date and notes", () => {
    const completed = noteToTask(
      source({
        libraryID: 5,
        libraryName: "Lab Group",
        blocks: [
          "Water plants",
          "[ ] 📅 2026-10-20 ⏳ 2026-10-19 🔁 every week ➕ 2026-09-01 see [[Garden]]",
        ],
        parent: { key: "PARENT01", title: "Botany" },
      }),
      DEFAULT_TASK_TAG,
    );
    // What complete_task hands to addTask: dates moved, extra kept.
    const next: Task = {
      ...completed,
      id: "ai-1",
      createdAt: "2026-10-18T10:00:00+08:00",
      dueAt: "2026-10-27",
      extra: { ...completed.extra, scheduledAt: "2026-10-26" },
    };
    const plan = planNewTaskNote(next);
    expect(plan.libraryID).toBe(5);
    expect(plan.parentKey).toBe("PARENT01");
    expect(plan.task.extra).toEqual({
      scheduledAt: "2026-10-26",
      lineNotes: "see [[Garden]]",
    });
    // A rule right before notes would read them as part of the rule.
    expect(metadataLineFor(plan.task)).toBe(
      "[ ] 🔁 every week 📅 2026-10-27 ⏳ 2026-10-26 see [[Garden]]",
    );
  });

  it("rejects a malformed library id", () => {
    expect(() =>
      planNewTaskNote({
        id: "x",
        title: "T",
        status: "todo",
        priority: "medium",
        tags: [],
        extra: { libraryID: "abc", noteKey: "ABCD1234" },
      }),
    ).toThrow(/library/i);
  });
});
