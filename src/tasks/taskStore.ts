import type { Task } from "@tasks-timeline/components";
import { config } from "../../package.json";
import { noteHtmlToBlocks } from "./noteBlocks";
import { noteToTask } from "./noteFormat";
import type { TaskSource } from "../shared/uiContract";

const RELOAD_DEBOUNCE_MS = 300;

// The bootstrap sandbox has no window timers; use Gecko's module.
const { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
);

export interface TaskLoadFailure {
  noteID: number;
  error: Error;
}

/**
 * Snapshot of all task notes (notes tagged with the task tag) across the user
 * library and group libraries, kept fresh through Zotero.Notifier.
 */
export class ZoteroTaskStore implements TaskSource {
  private tasks: readonly Task[] = [];
  private readonly listeners = new Set<() => void>();
  private observerID: string | undefined;
  private reloadTimer: number | undefined;

  constructor(
    private readonly taskTag: () => string,
    private readonly onLoadFailures: (failures: TaskLoadFailure[]) => void,
  ) {}

  async start(): Promise<void> {
    this.observerID = Zotero.Notifier.registerObserver(
      { notify: (event, type) => this.handleNotify(event, type) },
      ["item", "item-tag"],
      `${config.addonRef}-task-store`,
    );
    await this.reload();
  }

  stop(): void {
    if (this.observerID) {
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = undefined;
    }
    clearTimeout(this.reloadTimer);
    this.listeners.clear();
  }

  getTasks = (): readonly Task[] => this.tasks;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async reload(): Promise<void> {
    const failures: TaskLoadFailure[] = [];
    this.tasks = await this.loadAll(failures);
    if (failures.length > 0) {
      this.onLoadFailures(failures);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  private handleNotify(event: string, type: string): void {
    if (event === "refresh" && type === "item") return;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reload().catch((error) => Zotero.logError(error));
    }, RELOAD_DEBOUNCE_MS);
  }

  private async loadAll(failures: TaskLoadFailure[]): Promise<Task[]> {
    const taskTag = this.taskTag();
    const tagID = Zotero.Tags.getID(taskTag);
    // No item has ever carried the tag: there are simply no tasks yet.
    if (tagID === false) return [];

    const parser = new (Zotero.getMainWindow().DOMParser)();
    const tasks: Task[] = [];
    for (const library of Zotero.Libraries.getAll()) {
      if (library.libraryType === "feed") continue;
      const itemIDs = await Zotero.Tags.getTagItems(library.libraryID, tagID);
      const notes = (await Zotero.Items.getAsync(itemIDs)).filter(
        (item) => item.isNote() && !item.deleted,
      );
      for (const note of notes) {
        try {
          tasks.push(this.toTask(note, library, parser, taskTag));
        } catch (error) {
          failures.push({
            noteID: note.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }
    return tasks;
  }

  private toTask(
    note: Zotero.Item,
    library: { libraryID: number; name: string; editable: boolean },
    parser: DOMParser,
    taskTag: string,
  ): Task {
    const parent = note.parentItem;
    return noteToTask(
      {
        libraryID: library.libraryID,
        libraryName: library.name,
        editable: library.editable,
        key: note.key,
        blocks: noteHtmlToBlocks(note.getNote(), parser),
        tags: note.getTags().map((t) => t.tag),
        dateAdded: localDate(note.dateAdded),
        parent: parent
          ? { key: parent.key, title: parent.getDisplayTitle() }
          : undefined,
      },
      taskTag,
    );
  }
}

/** Zotero stores dateAdded as UTC "YYYY-MM-DD HH:MM:SS". */
function localDate(sqlUTC: string): string {
  const date = Zotero.Date.sqlToDate(sqlUTC, true);
  if (!date) {
    throw new Error(`Unparseable dateAdded "${sqlUTC}"`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
