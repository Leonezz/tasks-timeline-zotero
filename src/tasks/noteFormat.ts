/**
 * Pure mapping between a Zotero task note and a timeline Task. No Zotero or
 * DOM APIs here, so it runs under Node unit tests.
 *
 * Note layout:
 *   block 0: title (may also carry Tasks metadata, e.g. "Read paper 📅 2026-10-20")
 *   block 1: optional metadata line "[ ] ⏫ 📅 2026-10-20 🛫 2026-10-15"
 *   rest:    description
 */
import {
  formatTasksMetadata,
  getTaskStatusFromMarker,
  parseTasksFormatItem,
  statusToMarker,
} from "@tasks-timeline/components/tasks-format";
import type { Task } from "@tasks-timeline/components";

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

interface ParsedLine {
  text: string;
  fields: Partial<Task>;
  scheduledAt?: string;
  hasMetadata: boolean;
}

function parseLine(line: string): ParsedLine {
  const parsed = parseTasksFormatItem({
    id: "",
    title: line,
    status: "todo",
    priority: "medium",
    tags: [],
  });
  const fields: Partial<Task> = {};
  if (parsed.dueAt) fields.dueAt = parsed.dueAt;
  if (parsed.startAt) fields.startAt = parsed.startAt;
  if (parsed.createdAt) fields.createdAt = parsed.createdAt;
  if (parsed.completedAt) fields.completedAt = parsed.completedAt;
  if (parsed.recurringInterval) {
    fields.recurringInterval = parsed.recurringInterval;
    fields.isRecurring = true;
  }
  // "medium" is both the default and 🔼, so only high/low count as metadata.
  const hasPriority = parsed.priority !== "medium";
  if (hasPriority) fields.priority = parsed.priority;
  const scheduledAt = parsed.extra?.scheduledAt || undefined;
  return {
    text: parsed.title.trim(),
    fields,
    scheduledAt,
    hasMetadata:
      parsed.extra?.isTasksTask === "true" ||
      hasPriority ||
      !!fields.recurringInterval,
  };
}

/** True when a block is the metadata line (block 1) rather than prose. */
export function isMetadataBlock(block: string): boolean {
  return parseMetadataBlock(block) !== null;
}

/** Reads the optional metadata block; returns null when block 1 is description. */
function parseMetadataBlock(
  block: string | undefined,
): { marker?: string; line: ParsedLine } | null {
  if (block === undefined) return null;
  const checkbox = CHECKBOX_PREFIX.exec(block);
  if (checkbox) {
    return {
      marker: checkbox[1],
      line: parseLine(block.slice(checkbox[0].length)),
    };
  }
  const line = parseLine(block);
  // Only a line made entirely of metadata counts; otherwise it is prose.
  return line.hasMetadata && line.text === "" ? { line } : null;
}

export function noteToTask(source: TaskNoteSource, taskTag: string): Task {
  const [titleBlock = "", ...rest] = source.blocks;
  const titleLine = parseLine(titleBlock);
  const metadata = parseMetadataBlock(rest[0]);
  const description = (metadata ? rest.slice(1) : rest).join("\n");

  const fields = { ...titleLine.fields, ...metadata?.line.fields };
  const scheduledAt = metadata?.line.scheduledAt ?? titleLine.scheduledAt;
  const status = metadata?.marker
    ? getTaskStatusFromMarker(metadata.marker)
    : fields.completedAt
      ? "done"
      : "todo";

  const extra: Record<string, string> = {
    libraryID: String(source.libraryID),
    noteKey: source.key,
    editable: String(source.editable),
    dateAdded: source.dateAdded,
  };
  if (fields.createdAt) extra.createdExplicit = "true";
  if (scheduledAt) extra.scheduledAt = scheduledAt;
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
    isRecurring: fields.isRecurring,
    recurringInterval: fields.recurringInterval,
    category: source.libraryName,
    tags: source.tags
      .filter((tag) => tag !== taskTag)
      .map((tag) => ({ id: tag, name: tag })),
    extra,
  };
}

/**
 * The metadata line written to block 1, e.g. "[x] ⏫ 📅 2026-10-20 ✅ 2026-10-18".
 * ➕ is only written when the note already had one or the created date was
 * changed; otherwise the note's own dateAdded is the created date.
 */
export function metadataLineFor(task: Task): string {
  const extra = task.extra ?? {};
  const createdChanged =
    extra.dateAdded !== undefined &&
    task.createdAt !== undefined &&
    task.createdAt.slice(0, 10) !== extra.dateAdded;
  const writeCreated = extra.createdExplicit === "true" || createdChanged;
  const metadata = formatTasksMetadata({
    ...task,
    createdAt: writeCreated ? task.createdAt : undefined,
  });
  return `[${statusToMarker(task.status)}] ${metadata}`.trim();
}
