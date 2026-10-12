import { assert } from "chai";
import { config } from "../package.json";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  check: () => T | null | undefined | false,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe("task store", function () {
  this.timeout(20000);

  let store: any;
  const created: Zotero.Item[] = [];

  before(function () {
    // @ts-expect-error - Plugin instance is not typed
    store = Zotero[config.addonInstance].data.taskStore;
    assert.exists(store, "task store");
  });

  after(async function () {
    for (const item of created) {
      await item.eraseTx();
    }
  });

  async function createNote(html: string, tags: string[], parentID?: number) {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    if (parentID) note.parentID = parentID;
    note.setNote(html);
    for (const tag of tags) note.addTag(tag);
    await note.saveTx();
    created.push(note);
    return note;
  }

  function findTask(note: Zotero.Item) {
    return store
      .getTasks()
      .find((t: any) => t.id === `${note.libraryID}/${note.key}`);
  }

  it("loads tagged notes, including editor-wrapped HTML", async function () {
    const note = await createNote(
      '<div data-schema-version="9"><h1>Store test task</h1>\n' +
        "<p>[/] ⏫ 📅 2026-10-20</p>\n<p>Some notes</p>\n</div>",
      ["#task", "reading"],
    );
    const task = await waitFor(() => findTask(note), "task to load");
    assert.include(task, {
      title: "Store test task",
      status: "doing",
      priority: "high",
      dueAt: "2026-10-20",
      description: "Some notes",
    });
    assert.deepEqual(
      task.tags.map((t: any) => t.name),
      ["reading"],
    );
  });

  it("ignores notes without the task tag", async function () {
    const note = await createNote("<p>Not a task</p>", ["reading"]);
    await delay(800);
    assert.notExists(findTask(note));
  });

  it("records the parent item of child notes", async function () {
    const parent = new Zotero.Item("journalArticle");
    parent.libraryID = Zotero.Libraries.userLibraryID;
    parent.setField("title", "Parent paper");
    await parent.saveTx();
    created.push(parent);
    const note = await createNote("<p>Child task</p>", ["#task"], parent.id);
    const task = await waitFor(() => findTask(note), "child task");
    assert.include(task.extra, {
      parentKey: parent.key,
      parentTitle: "Parent paper",
    });
  });

  it("refreshes when a note changes and when it is trashed", async function () {
    const note = await createNote("<p>Before</p>", ["#task"]);
    await waitFor(() => findTask(note), "task to load");

    note.setNote("<p>After</p><p>[x] ✅ 2026-10-11</p>");
    await note.saveTx();
    await waitFor(
      () => findTask(note)?.title === "After" && findTask(note),
      "task to update",
    );
    assert.equal(findTask(note).status, "done");

    note.deleted = true;
    await note.saveTx();
    await waitFor(() => !findTask(note), "trashed task to disappear");
  });

  it("notifies subscribers with a new snapshot", async function () {
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    const before = store.getTasks();
    await createNote("<p>Subscriber test</p>", ["#task"]);
    await waitFor(() => calls > 0, "subscriber call");
    unsubscribe();
    assert.notStrictEqual(store.getTasks(), before);
  });
});
