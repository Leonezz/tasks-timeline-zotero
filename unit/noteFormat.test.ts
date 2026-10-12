import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_TAG,
  isMetadataBlock,
  metadataLineFor,
  noteToTask,
  parseTaskId,
  taskIdFor,
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
