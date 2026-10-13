/**
 * Tools that let the agent create tasks tied to library items. All writes go
 * through ZoteroTaskMutations, so read-only libraries and undo behave the
 * same as edits made in the timeline.
 */
import type { Priority } from "@tasks-timeline/components";
import { getTaskTag } from "../settings/zoteroPrefs";
import { parseTaskId } from "../tasks/noteFormat";
import { noteHtmlToBlocks } from "../tasks/noteBlocks";
import type { ZoteroTaskMutations } from "../tasks/taskMutations";
import { proposeTasksFromAnnotations } from "./annotationTasks";
import type { HostTool, LibraryAccess, PreparedPlan } from "./libraryTools";
import { requiredStringArg, stringArg } from "./toolOutput";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: Priority[] = ["low", "medium", "high"];

function dateArg(value: unknown, name: string): string | undefined {
  const date = stringArg(value, name);
  if (date && !DATE.test(date)) {
    throw new Error(`"${name}" must be a date like 2026-10-20`);
  }
  return date;
}

function regularItem(ref: string): Zotero.Item {
  const { libraryID, key } = parseTaskId(ref);
  const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!item || item.deleted) throw new Error(`No item ${ref} in the library`);
  if (!item.isRegularItem()) {
    throw new Error(
      `${ref} is not a regular item; tasks attach to papers, books, etc.`,
    );
  }
  return item;
}

const refOf = (item: Zotero.Item) => `${item.libraryID}/${item.key}`;

export function createWriteTools(
  mutations: ZoteroTaskMutations,
  getAccess: () => LibraryAccess,
): HostTool[] {
  return [
    {
      name: "create_task_for_item",
      description:
        "Create a task about a specific library item (saved as a child note of that item). Use create_task instead for tasks not tied to an item.",
      schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: 'Item ref, e.g. "1/ABCD2345"' },
          title: { type: "string", description: "Task title" },
          dueAt: { type: "string", description: "Due date, YYYY-MM-DD" },
          startAt: { type: "string", description: "Start date, YYYY-MM-DD" },
          priority: { type: "string", description: "low, medium or high" },
          description: { type: "string", description: "Optional details" },
          tags: { type: "array", description: "Tag names" },
        },
        required: ["ref", "title"],
      },
      execute: async (args) => {
        const item = regularItem(requiredStringArg(args.ref, "ref"));
        const priority = stringArg(args.priority, "priority") ?? "medium";
        if (!PRIORITIES.includes(priority as Priority)) {
          throw new Error(`"priority" must be one of ${PRIORITIES.join(", ")}`);
        }
        const tags = args.tags ?? [];
        if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
          throw new Error(`"tags" must be a list of tag names`);
        }
        const note = await mutations.addTaskForItem(item, {
          title: requiredStringArg(args.title, "title"),
          dueAt: dateArg(args.dueAt, "dueAt"),
          startAt: dateArg(args.startAt, "startAt"),
          priority: priority as Priority,
          description: stringArg(args.description, "description"),
          tags: (tags as string[]).map((name) => ({ id: name, name })),
        });
        return { created: true, taskId: refOf(note), item: refOf(item) };
      },
    },
    {
      name: "tasks_from_annotations",
      description:
        'Turn to-do annotations in an item\'s PDFs/EPUBs (comments or highlights marked TODO, "[ ]", 待办 …, or containing a given keyword) into tasks under that item. The user reviews and picks which ones to create before anything is written. Needs annotation access.',
      schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Item ref" },
          match: {
            type: "string",
            description:
              "Optional keyword to look for instead of to-do markers",
          },
          dueAt: {
            type: "string",
            description: "Optional due date for the new tasks, YYYY-MM-DD",
          },
        },
        required: ["ref"],
      },
      prepare: async (args): Promise<PreparedPlan> => {
        if (!getAccess().annotations) {
          throw new Error(
            "Reading annotations is turned off. The user can allow it in the timeline's Settings → Zotero tab.",
          );
        }
        const item = regularItem(requiredStringArg(args.ref, "ref"));
        const dueAt = dateArg(args.dueAt, "dueAt");
        const annotations = Zotero.Items.get(item.getAttachments())
          .filter((a) => a.isFileAttachment())
          .flatMap((a) => a.getAnnotations())
          .map((a) => ({
            key: a.key,
            text: a.annotationText || undefined,
            comment: a.annotationComment || undefined,
            pageLabel: a.annotationPageLabel || undefined,
          }));
        const taskTag = getTaskTag();
        const parser = new (Zotero.getMainWindow().DOMParser)();
        const existing = Zotero.Items.get(item.getNotes())
          .filter((n) => n.hasTag(taskTag))
          .map((n) => noteHtmlToBlocks(n.getNote(), parser).join("\n"));
        const { proposals, alreadyTasks } = proposeTasksFromAnnotations(
          annotations,
          existing,
          stringArg(args.match, "match"),
        );
        return {
          title: `Create tasks for “${item.getDisplayTitle()}”`,
          summary: {
            item: refOf(item),
            annotationsChecked: annotations.length,
            alreadyTasks,
          },
          choices: proposals.map((p) => ({
            label: p.title,
            detail: p.description,
          })),
          commit: async (selected) => {
            const created: string[] = [];
            for (const index of selected) {
              const proposal = proposals[index];
              const note = await mutations.addTaskForItem(item, {
                title: proposal.title,
                description: proposal.description,
                dueAt,
              });
              created.push(refOf(note));
            }
            return {
              created: created.length,
              taskIds: created,
              declined: proposals.length - created.length,
              alreadyTasks,
            };
          },
        };
      },
    },
  ];
}
