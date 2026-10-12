import type { Task } from "@tasks-timeline/components";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { applyTaskNoteContent, newTaskNoteHtml } from "./noteEditing";
import { metadataLineFor, parseTaskId } from "./noteFormat";
import type { TaskActions } from "../shared/uiContract";
import type { ZoteroTaskStore } from "./taskStore";

// Fluent IDs from addon.ftl; the scaffold prefixes them with the addon ref.
const UNDO_EDIT = `${config.addonRef}-undo-edit-task`;
const UNDO_TRASH = `${config.addonRef}-undo-trash-task`;

// DataObject.saveTx() accepts these since Zotero 10; zotero-types lags behind.
type SaveOptions = {
  undoAction?: string;
  undoActionArgs?: object;
  skipSelect?: boolean;
};
const saveWithUndo = (item: Zotero.Item, options: SaveOptions) =>
  (item.saveTx as (options: SaveOptions) => Promise<unknown>)(options);

/**
 * Writes timeline edits back to task notes. Every write goes through here so
 * permission checks and undo labels are applied in one place.
 */
export class ZoteroTaskMutations implements TaskActions {
  constructor(
    private readonly store: ZoteroTaskStore,
    private readonly taskTag: string,
  ) {}

  addTask = async (task: Task): Promise<void> => {
    await this.createTaskNote(Zotero.Libraries.userLibraryID, task);
  };

  updateTask = async (task: Task, previous: Task): Promise<void> => {
    const note = this.requireEditableNote(task.id);
    await this.writeNote(note, UNDO_EDIT, () => {
      note.setNote(
        applyTaskNoteContent(
          note.getNote(),
          {
            title: task.title,
            metadataLine: metadataLineFor(task),
            description:
              task.description !== previous.description
                ? (task.description ?? "")
                : undefined,
          },
          this.parser(),
        ),
      );
      this.syncTags(note, task);
    });
  };

  deleteTask = async (taskId: string): Promise<void> => {
    const note = this.requireEditableNote(taskId);
    // A trashed note is closed, not re-saved, by its editor.
    await this.writeNote(
      note,
      UNDO_TRASH,
      () => {
        note.deleted = true;
      },
      { awaitEditor: false },
    );
  };

  private readonly noteQueues = new Map<number, Promise<void>>();

  /**
   * Applies one edit to a note. Edits to the same note run one at a time; each
   * reads and saves inside a single transaction so a note editor's save can't
   * land between our read and our save (they share the cached Zotero.Item).
   * If the note is open in an editor, we wait for the editor to re-save our
   * version before the next edit starts, so it can't overwrite that edit
   * later with content it rendered earlier.
   */
  private async writeNote(
    note: Zotero.Item,
    undoAction: string,
    mutate: () => void,
    { awaitEditor = true } = {},
  ): Promise<void> {
    const previous = this.noteQueues.get(note.id) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        await flushOpenEditors(note);
        const echo =
          awaitEditor && hasOpenEditor(note) ? waitForEditorEcho(note) : null;
        await Zotero.DB.executeTransaction(async () => {
          mutate();
          await (note.save as (options: SaveOptions) => Promise<unknown>)({
            undoAction,
          });
        });
        await echo;
      });
    this.noteQueues.set(note.id, run);
    try {
      await run;
    } finally {
      if (this.noteQueues.get(note.id) === run) this.noteQueues.delete(note.id);
    }
    await this.store.reload();
  }

  revealTask = async (task: Task): Promise<void> => {
    const { libraryID, key } = parseTaskId(task.id);
    const note = this.requireNote(libraryID, key);
    const win = Zotero.getMainWindow();
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.selectItem(note.id);
  };

  /** Creates a child task note for an item; returns the new note. */
  async addTaskForItem(item: Zotero.Item): Promise<Zotero.Item> {
    if (!item.isRegularItem()) {
      throw new Error(getString("error-task-parent-type"));
    }
    return this.createTaskNote(
      item.libraryID,
      {
        id: "",
        title: getString("task-for-item-title", {
          args: { title: item.getDisplayTitle() },
        }),
        status: "todo",
        priority: "medium",
        tags: [],
      },
      item.id,
    );
  }

  private async createTaskNote(
    libraryID: number,
    task: Task,
    parentID?: number,
  ): Promise<Zotero.Item> {
    this.requireEditableLibrary(libraryID);
    const note = new Zotero.Item("note");
    note.libraryID = libraryID;
    if (parentID !== undefined) note.parentID = parentID;
    note.setNote(
      newTaskNoteHtml(
        {
          title: task.title,
          metadataLine: metadataLineFor({ ...task, extra: undefined }),
          description: task.description,
        },
        this.parser(),
      ),
    );
    this.syncTags(note, task);
    // Don't pull the user away from where they are; callers select if needed.
    await saveWithUndo(note, { skipSelect: true });
    await this.store.reload();
    return note;
  }

  private syncTags(note: Zotero.Item, task: Task): void {
    const wanted = new Set([this.taskTag, ...task.tags.map((t) => t.name)]);
    const current = note.getTags().map((t) => t.tag);
    for (const tag of current) {
      if (!wanted.has(tag)) note.removeTag(tag);
    }
    for (const tag of wanted) {
      if (!current.includes(tag)) note.addTag(tag);
    }
  }

  private requireNote(libraryID: number, key: string): Zotero.Item {
    const note = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (!note || !note.isNote() || note.deleted) {
      throw new Error(getString("error-task-missing"));
    }
    return note;
  }

  private requireEditableNote(taskId: string): Zotero.Item {
    const { libraryID, key } = parseTaskId(taskId);
    this.requireEditableLibrary(libraryID);
    return this.requireNote(libraryID, key);
  }

  private requireEditableLibrary(libraryID: number): void {
    const library = Zotero.Libraries.get(libraryID);
    if (!library) {
      throw new Error(`Library ${libraryID} not found`);
    }
    if (!library.editable) {
      throw new Error(
        getString("error-library-read-only", { args: { name: library.name } }),
      );
    }
  }

  private parser(): DOMParser {
    return new (Zotero.getMainWindow().DOMParser)();
  }
}

interface EditorInternals {
  _item?: Zotero.Item;
  _initPromise?: Promise<void>;
  _iframeWindow?: {
    wrappedJSObject?: { getDataSync?: (onlyChanged: boolean) => unknown };
  };
  _save?: (noteData: unknown) => Promise<void>;
}

/**
 * Saves unsaved changes in any note editor showing this note, and waits for
 * the save. Without this, an editor's pending save could overwrite our write,
 * or our write could discard what the user just typed. Uses editor internals,
 * so if Zotero changes them we refuse to write rather than risk losing data.
 */
function openEditors(note: Zotero.Item): EditorInternals[] {
  const editors = (Zotero.Notes as unknown as { _editorInstances?: unknown })
    ._editorInstances;
  if (!Array.isArray(editors)) {
    throw new Error(getString("error-editor-api"));
  }
  return (editors as EditorInternals[]).filter((e) => e._item?.id === note.id);
}

function hasOpenEditor(note: Zotero.Item): boolean {
  return openEditors(note).length > 0;
}

// An editor re-saves an external change within ~20ms when its normalized
// HTML differs from ours; when it doesn't differ it never saves, so cap the wait.
const EDITOR_ECHO_TIMEOUT_MS = 500;

/** Resolves when a note editor re-saves this note, or after a short timeout. */
function waitForEditorEcho(note: Zotero.Item): Promise<void> {
  return new Promise((resolve) => {
    let observerID: string | undefined;
    const done = () => {
      if (observerID) Zotero.Notifier.unregisterObserver(observerID);
      observerID = undefined;
      resolve();
    };
    const timer = Zotero.getMainWindow().setTimeout(
      done,
      EDITOR_ECHO_TIMEOUT_MS,
    );
    observerID = Zotero.Notifier.registerObserver(
      {
        notify: (event, _type, ids, extraData) => {
          const data = (extraData as Record<number, { noteEditorID?: string }>)[
            note.id
          ];
          if (
            event === "modify" &&
            (ids as Array<number | string>).includes(note.id) &&
            data?.noteEditorID
          ) {
            Zotero.getMainWindow().clearTimeout(timer);
            done();
          }
        },
      },
      ["item"],
      `${config.addonRef}-editor-echo`,
    );
  });
}

async function flushOpenEditors(note: Zotero.Item): Promise<void> {
  for (const editor of openEditors(note)) {
    await editor._initPromise;
    const getDataSync = editor._iframeWindow?.wrappedJSObject?.getDataSync;
    if (
      typeof getDataSync !== "function" ||
      typeof editor._save !== "function"
    ) {
      throw new Error(getString("error-editor-api"));
    }
    const noteData = getDataSync(true);
    if (noteData) {
      await editor._save(JSON.parse(JSON.stringify(noteData)));
    }
  }
}
