/**
 * Pure mapping between a Zotero task note and a timeline Task. No Zotero or
 * DOM APIs here, so it runs under Node unit tests.
 *
 * Note layout:
 *   block 0: title (may also carry Tasks metadata, e.g. "Read paper 📅 2026-10-20")
 *   block 1: optional metadata line "[ ] ⏫ 📅 2026-10-20 🛫 2026-10-15"
 *   rest:    description
 *
 * Writes edit blocks 0 and 1 in place with the library's taskToMarkdown, so
 * text the task model doesn't hold (notes after the fields, ⏰ reminders,
 * block ids, symbol variants) stays as written.
 */
import {
  getTaskStatusFromMarker,
  parseTasksFormatItem,
  taskToMarkdown,
} from "@tasks-timeline/components/tasks-format";
import type { Priority, Task } from "@tasks-timeline/components";
import { repairLegacyRecurrence } from "./legacyRecurrence";

export { repairLegacyRecurrence } from "./legacyRecurrence";

export const DEFAULT_TASK_TAG = "#task";

export interface TaskNoteSource {
  libraryID: number;
  libraryName: string;
  editable: boolean;
  key: string;
  /** Plain text of the note's top-level blocks, in order, empty ones removed. */
  blocks: string[];
  /** All Zotero tag names on the note, including the task tag. */
  tags: string[];
  /** Local calendar date the note was added, YYYY-MM-DD. */
  dateAdded: string;
  parent?: { key: string; title: string };
}

const CHECKBOX_PREFIX = /^\[(.)\]\s*/u;

export function taskIdFor(libraryID: number, key: string): string {
  return `${libraryID}/${key}`;
}

export function parseTaskId(id: string): { libraryID: number; key: string } {
  const match = /^(\d+)\/([A-Z0-9]{8})$/.exec(id);
  if (!match) {
    throw new Error(`Malformed task id "${id}"`);
  }
  return { libraryID: Number(match[1]), key: match[2] };
}

/** The Tasks fields a block can hold; scheduledAt lives in task.extra. */
interface Fields {
  priority?: Priority;
  dueAt?: string;
  startAt?: string;
  scheduledAt?: string;
  createdAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  recurringInterval?: string;
  onCompletion?: string;
  taskId?: string;
  dependsOn?: string[];
}

const FIELD_NAMES = [
  "priority",
  "dueAt",
  "startAt",
  "scheduledAt",
  "createdAt",
  "completedAt",
  "cancelledAt",
  "recurringInterval",
  "onCompletion",
  "taskId",
  "dependsOn",
] as const satisfies readonly (keyof Fields)[];

interface ParsedLine {
  /** The title Obsidian Tasks reads from the text (tags kept, ⏰ removed). */
  text: string;
  fields: Fields;
  /** Notes and links after the fields. */
  notes?: string;
  hasMetadata: boolean;
}

/** The fields a task holds, as they are written to a note. */
function fieldsOf(task: Task): Fields {
  return {
    // "medium" is both the default and 🔼, so only high/low are written.
    priority: task.priority !== "medium" ? task.priority : undefined,
    dueAt: task.dueAt,
    startAt: task.startAt,
    scheduledAt: task.extra?.scheduledAt || undefined,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    cancelledAt: task.cancelledAt,
    recurringInterval: task.recurringInterval,
    onCompletion: task.onCompletion,
    taskId: task.taskId,
    dependsOn: task.dependsOn?.length ? task.dependsOn : undefined,
  };
}

/** Only the fields that are set, so spreading never clears a field. */
function setFields(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Fields;
}

function parseLine(line: string): ParsedLine {
  const parsed = parseTasksFormatItem({
    id: "",
    title: line,
    status: "todo",
    priority: "medium",
    tags: [],
  });
  const fields = setFields(fieldsOf(parsed));
  return {
    text: parsed.title.trim(),
    fields,
    notes: parsed.extra?.lineNotes || undefined,
    hasMetadata:
      parsed.extra?.isTasksTask === "true" ||
      fields.priority !== undefined ||
      fields.recurringInterval !== undefined,
  };
}

/** True when a block is the metadata line (block 1) rather than prose. */
export function isMetadataBlock(block: string): boolean {
  return parseMetadataBlock(block) !== null;
}

interface MetadataBlock {
  marker?: string;
  /** The text after the checkbox (all of it without one). */
  body: string;
  line: ParsedLine;
}

/** Reads the optional metadata block; returns null when block 1 is description. */
function parseMetadataBlock(block: string | undefined): MetadataBlock | null {
  if (block === undefined) return null;
  const text = repairLegacyRecurrence(block).text;
  const checkbox = CHECKBOX_PREFIX.exec(text);
  if (checkbox) {
    const body = text.slice(checkbox[0].length);
    return { marker: checkbox[1], body, line: parseLine(body) };
  }
  const line = parseLine(text);
  // Only a line made entirely of metadata counts; otherwise it is prose.
  return line.hasMetadata && line.text === "" ? { body: text, line } : null;
}

export function noteToTask(source: TaskNoteSource, taskTag: string): Task {
  const [titleBlock = "", ...rest] = source.blocks;
  const titleLine = parseLine(repairLegacyRecurrence(titleBlock).text);
  const metadata = parseMetadataBlock(rest[0]);
  const description = (metadata ? rest.slice(1) : rest).join("\n");

  const fields = { ...titleLine.fields, ...metadata?.line.fields };
  const status = metadata?.marker
    ? getTaskStatusFromMarker(metadata.marker)
    : fields.completedAt
      ? "done"
      : "todo";
  // Text that isn't the title: kept in place on edits, and written after the
  // fields of a new note made from this task (the next occurrence).
  const lineNotes = [titleLine.notes, metadata?.line.text, metadata?.line.notes]
    .filter((text) => !!text)
    .join(" ");

  const extra: Record<string, string> = {
    libraryID: String(source.libraryID),
    noteKey: source.key,
    editable: String(source.editable),
    dateAdded: source.dateAdded,
  };
  if (fields.createdAt) extra.createdExplicit = "true";
  if (fields.scheduledAt) extra.scheduledAt = fields.scheduledAt;
  if (lineNotes) extra.lineNotes = lineNotes;
  if (source.parent) {
    extra.parentKey = source.parent.key;
    extra.parentTitle = source.parent.title;
  }

  return {
    id: taskIdFor(source.libraryID, source.key),
    title: titleLine.text || titleBlock.trim(),
    description: description || undefined,
    status,
    priority: fields.priority ?? "medium",
    createdAt: fields.createdAt ?? source.dateAdded,
    startAt: fields.startAt,
    dueAt: fields.dueAt,
    completedAt: fields.completedAt,
    cancelledAt: fields.cancelledAt,
    isRecurring: fields.recurringInterval ? true : undefined,
    recurringInterval: fields.recurringInterval,
    onCompletion: fields.onCompletion,
    taskId: fields.taskId,
    dependsOn: fields.dependsOn,
    category: source.libraryName,
    tags: source.tags
      .filter((tag) => tag !== taskTag)
      .map((tag) => ({ id: tag, name: tag })),
    extra,
  };
}

/** The fields to write for a task. */
function fieldsToWrite(task: Task): Fields {
  // ➕ is only written when the note already had one or the created date was
  // changed; otherwise the note's own dateAdded is the created date.
  const extra = task.extra ?? {};
  const createdChanged =
    extra.dateAdded !== undefined &&
    task.createdAt !== undefined &&
    task.createdAt.slice(0, 10) !== extra.dateAdded;
  const writeCreated = extra.createdExplicit === "true" || createdChanged;
  return {
    ...fieldsOf(task),
    createdAt: writeCreated ? task.createdAt : undefined,
  };
}

/**
 * Writes a title and fields onto one block with taskToMarkdown. Zotero tags
 * are note tags, never written into the text, so the line task has none.
 */
function writeLine(
  block: { marker: string; body: string },
  task: Pick<Task, "title" | "status">,
  fields: Fields,
  lineNotes?: string,
): string {
  const { scheduledAt, priority, ...values } = fields;
  const original = `- [${block.marker}] ${block.body}`;
  const line = taskToMarkdown(
    {
      ...values,
      id: "",
      ...task,
      priority: priority ?? "medium",
      tags: [],
      extra: {
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(lineNotes ? { lineNotes } : {}),
      },
    },
    original,
  );
  if (!line.startsWith("- [")) {
    throw new Error(`Could not write the task line "${original}"`);
  }
  return line.slice(2).trimEnd();
}

/** The block text with a 0.8 rule repaired; throws when it can't be. */
function writableBlock(block: string): string {
  const repair = repairLegacyRecurrence(block);
  if (repair.error) throw new Error(repair.error);
  return repair.text;
}

export interface TaskBlocks {
  /** Block 0. */
  title: string;
  /** Block 1, e.g. "[x] ⏫ 📅 2026-10-20 ✅ 2026-10-18". */
  metadataLine: string;
}

/**
 * The title and metadata blocks for a task. Without `current` they are for a
 * new note. With the note's current blocks, each is edited in place: a field
 * stays in the block it is written in (block 1 wins when both have it, as on
 * reading), new fields go to block 1, and text the task doesn't hold stays
 * as written, so a block the edit doesn't change comes back byte for byte.
 * Throws for a task a note's line can't hold.
 */
export function writeTaskBlocks(
  task: Task,
  current?: { title: string; metadata?: string },
): TaskBlocks {
  const wanted = fieldsToWrite(task);
  const status = { title: "", status: task.status };
  if (!current) {
    return {
      title: task.title,
      metadataLine: writeLine(
        { marker: " ", body: "" },
        status,
        wanted,
        task.extra?.lineNotes,
      ),
    };
  }

  const titleText = writableBlock(current.title);
  const titleLine = parseLine(titleText);
  const metadata =
    current.metadata === undefined
      ? null
      : parseMetadataBlock(writableBlock(current.metadata));
  const inMetadata = metadata?.line.fields ?? {};

  const titleFields: Record<string, unknown> = {};
  const metadataFields: Record<string, unknown> = {};
  // A field stays in the block that has it; block 1 wins when both do.
  for (const name of FIELD_NAMES) {
    const inTitle = titleLine.fields[name] !== undefined;
    if (inTitle && inMetadata[name] === undefined) {
      titleFields[name] = wanted[name];
    } else {
      metadataFields[name] = wanted[name];
      // Block 1 overrides it; drop it from block 0 only if the task did.
      if (inTitle && wanted[name] !== undefined) {
        titleFields[name] = titleLine.fields[name];
      }
    }
  }

  // A title block of only fields is shown with its fields as the title.
  const title =
    titleLine.text === "" && task.title === titleText.trim() ? "" : task.title;
  return {
    // Block 0 has no checkbox: write it as an open task and drop the "[ ] ".
    title: writeLine(
      { marker: " ", body: titleText },
      { title, status: "todo" },
      titleFields,
    ).slice(4),
    // The checkbox shows the task's status; a marker meaning it is kept.
    metadataLine: writeLine(
      { marker: metadata?.marker ?? " ", body: metadata?.body ?? "" },
      { ...status, title: metadata?.line.text ?? "" },
      metadataFields,
    ),
  };
}

/**
 * The metadata line of a new note, e.g. "[x] ⏫ 📅 2026-10-20 ✅ 2026-10-18".
 */
export function metadataLineFor(task: Task): string {
  return writeTaskBlocks(task).metadataLine;
}

export interface NewTaskNotePlan {
  /** The task to write, with only the extra fields a new note keeps. */
  task: Task;
  /** The library to create the note in; My Library when undefined. */
  libraryID?: number;
  /** The key of the item to create the note under. */
  parentKey?: string;
}

/**
 * Where a new task note goes. A task made from an existing one, such as the
 * next occurrence of a recurring task, keeps its library, parent item, ⏳
 * date and notes; note-specific extra fields (key, dateAdded) are dropped.
 */
export function planNewTaskNote(task: Task): NewTaskNotePlan {
  const extra = task.extra ?? {};
  let libraryID: number | undefined;
  if (extra.libraryID !== undefined) {
    libraryID = Number(extra.libraryID);
    if (!Number.isInteger(libraryID)) {
      throw new Error(
        `Task "${task.title}" has a malformed library id "${extra.libraryID}"`,
      );
    }
  }
  const kept = setFields({
    scheduledAt: extra.scheduledAt || undefined,
  }) as Record<string, string>;
  if (extra.lineNotes) kept.lineNotes = extra.lineNotes;
  return {
    task: { ...task, extra: Object.keys(kept).length > 0 ? kept : undefined },
    libraryID,
    parentKey: extra.parentKey || undefined,
  };
}
