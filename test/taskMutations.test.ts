import { assert } from "chai";
import { config } from "../package.json";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The note editor re-saves notes it shows: it wraps them in
 * <div data-schema-version> and adds line breaks. Compare structure only.
 */
function flat(html: string): string {
  return html
    .replace(/^<div data-schema-version="\d+">/, "")
    .replace(/<\/div>\s*$/, "")
    .replace(/>\s*\n\s*/g, ">")
    .replace(/\s*\n\s*</g, "<")
    .trim();
}

describe("task mutations", function () {
  this.timeout(20000);

  let store: any;
  let mutations: any;
  const created: Zotero.Item[] = [];

  before(function () {
    // @ts-expect-error - Plugin instance is not typed
    const data = Zotero[config.addonInstance].data;
    store = data.taskStore;
    mutations = data.taskMutations;
    assert.exists(mutations, "task mutations");
  });

  after(async function () {
    for (const item of created) {
      if (Zotero.Items.get(item.id)) await item.eraseTx();
    }
  });

  async function createNote(html: string, tags = ["#task"]) {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote(html);
    for (const tag of tags) note.addTag(tag);
    // Keep the note editor out of it unless a test opens it on purpose.
    await note.saveTx({ skipSelect: true } as any);
    created.push(note);
    await store.reload();
    return note;
  }

  function taskFor(note: Zotero.Item) {
    const task = store
      .getTasks()
      .find((t: any) => t.id === `${note.libraryID}/${note.key}`);
    assert.exists(task, `task for note ${note.key}`);
    return JSON.parse(JSON.stringify(task));
  }

  function noteByTitle(title: string): Zotero.Item {
    const task = store.getTasks().find((t: any) => t.title === title);
    assert.exists(task, `task "${title}"`);
    const [libraryID, key] = task.id.split("/");
    const note = Zotero.Items.getByLibraryAndKey(Number(libraryID), key);
    created.push(note as Zotero.Item);
    return note as Zotero.Item;
  }

  it("adds a new task note to My Library", async function () {
    await mutations.addTask({
      id: "temp",
      title: "Brand new task",
      status: "todo",
      priority: "high",
      dueAt: "2026-11-01",
      createdAt: "2026-10-13T10:00:00.000+08:00",
      tags: [{ id: "reading", name: "reading" }],
    });
    const note = noteByTitle("Brand new task");
    assert.equal(note.libraryID, Zotero.Libraries.userLibraryID);
    assert.equal(
      note.getNote(),
      "<h1>Brand new task</h1><p>[ ] ⏫ 📅 2026-11-01</p>",
    );
    assert.sameMembers(
      note.getTags().map((t) => t.tag),
      ["#task", "reading"],
    );
  });

  it("updates title, status, dates and tags but keeps rich content", async function () {
    const note = await createNote(
      '<div data-schema-version="9"><h1>Old title 📅 2026-10-20</h1>\n' +
        "<ul><li>keep <strong>this</strong></li></ul>\n</div>",
      ["#task", "old-tag"],
    );
    const before = taskFor(note);
    assert.equal(before.title, "Old title");
    await mutations.updateTask(
      {
        ...before,
        title: "New title",
        status: "done",
        completedAt: "2026-10-13T09:00:00.000+08:00",
        tags: [{ id: "new-tag", name: "new-tag" }],
      },
      before,
    );
    const html = note.getNote();
    assert.include(html, '<div data-schema-version="9">');
    assert.equal(
      flat(html),
      // The 📅 date stays where it was written; new fields go to line 2.
      "<h1>New title 📅 2026-10-20</h1><p>[x] ✅ 2026-10-13</p>" +
        "<ul><li>keep <strong>this</strong></li></ul>",
    );
    assert.sameMembers(
      note.getTags().map((t) => t.tag),
      ["#task", "new-tag"],
    );
    assert.include(taskFor(note), { title: "New title", status: "done" });
  });

  it("rewrites the description only when it changed", async function () {
    const note = await createNote(
      "<p>Desc task</p><p>[ ] 📅 2026-10-20</p><p>old <em>notes</em></p>",
    );
    const before = taskFor(note);
    await mutations.updateTask({ ...before, priority: "low" }, before);
    assert.include(flat(note.getNote()), "<p>old <em>notes</em></p>");

    const middle = taskFor(note);
    await mutations.updateTask(
      { ...middle, description: "line one\nline two" },
      middle,
    );
    assert.equal(
      flat(note.getNote()),
      "<p>Desc task</p><p>[ ] 📅 2026-10-20 🔽</p><p>line one</p><p>line two</p>",
    );
  });

  it("keeps fields and text the timeline doesn't show", async function () {
    const note = await createNote(
      "<h1>Read paper 📅 2026-10-20 see [[Garden]]</h1>" +
        "<p>[ ] 🆔 abc ⛔ xyz 🏁 delete</p>",
    );
    const before = taskFor(note);
    assert.include(before, { title: "Read paper", taskId: "abc" });
    await mutations.updateTask(
      {
        ...before,
        status: "done",
        completedAt: "2026-10-13T09:00:00.000+08:00",
      },
      before,
    );
    assert.equal(
      flat(note.getNote()),
      "<h1>Read paper 📅 2026-10-20 see [[Garden]]</h1>" +
        "<p>[x] 🆔 abc ⛔ xyz 🏁 delete ✅ 2026-10-13</p>",
    );
  });

  it("keeps the markup of a line the edit doesn't change", async function () {
    const note = await createNote(
      '<h1>Read <a href="https://example.com/">the paper</a></h1>' +
        "<p>[ ] 📅 2026-10-20</p>",
    );
    const before = taskFor(note);
    await mutations.updateTask({ ...before, priority: "high" }, before);
    assert.equal(
      flat(note.getNote()),
      '<h1>Read <a href="https://example.com/">the paper</a></h1>' +
        "<p>[ ] 📅 2026-10-20 ⏫</p>",
    );
  });

  it("writes the ❌ date of a cancelled task", async function () {
    const note = await createNote("<p>Cancel me</p><p>[ ] 📅 2026-10-20</p>");
    const before = taskFor(note);
    await mutations.updateTask(
      {
        ...before,
        status: "cancelled",
        cancelledAt: "2026-10-17T10:00:00.000+08:00",
      },
      before,
    );
    assert.equal(
      flat(note.getNote()),
      "<p>Cancel me</p><p>[-] 📅 2026-10-20 ❌ 2026-10-17</p>",
    );
    assert.include(taskFor(note), { cancelledAt: "2026-10-17" });
  });

  // Tasks Timeline 0.1 (components 0.8) wrote a rule with a start date as
  // "🔁 DTSTART:…" and "RRULE:…" separated by a line break.
  it("repairs a rule an earlier version wrote with a start date", async function () {
    const note = await createNote(
      "<p>Water plants</p>" +
        "<p>[ ] 📅 2026-10-20 🔁 DTSTART:20261016T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO</p>",
    );
    const before = taskFor(note);
    assert.include(before, {
      startAt: "2026-10-16",
      recurringInterval: "every week on Monday",
    });
    await mutations.updateTask({ ...before, priority: "high" }, before);
    assert.equal(
      flat(note.getNote()),
      "<p>Water plants</p>" +
        "<p>[ ] 📅 2026-10-20 🛫 2026-10-16 🔁 every week on Monday ⏫</p>",
    );
  });

  it("explains how to fix an old rule it can't repair", async function () {
    const html =
      "<p>Water daily</p>" +
      "<p>[ ] 🛫 2026-10-01 🔁 DTSTART:20261016T000000\nRRULE:FREQ=DAILY</p>";
    const note = await createNote(html);
    const before = taskFor(note);
    let message = "";
    await mutations
      .updateTask({ ...before, priority: "high" }, before)
      .catch((e: Error) => (message = e.message));
    assert.include(message, "Zotero");
    assert.notInclude(message, "line below");
    assert.equal(note.getNote(), html);
  });

  it("creates the next occurrence next to the completed task", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Botany");
    await item.saveTx({ skipSelect: true } as any);
    created.push(item);
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    note.setNote(
      "<p>Water plants weekly</p>" +
        "<p>[ ] 📅 2026-10-20 ⏳ 2026-10-19 🔁 every week see [[Garden]]</p>",
    );
    note.addTag("#task");
    await note.saveTx({ skipSelect: true } as any);
    created.push(note);
    await store.reload();

    // What complete_task hands to addTask: dates moved, extra kept.
    const current = taskFor(note);
    const stored = await mutations.addTask({
      ...current,
      id: "ai-next",
      createdAt: "2026-10-18T10:00:00.000+08:00",
      dueAt: "2026-10-27",
      extra: { ...current.extra, scheduledAt: "2026-10-26" },
    });
    const [libraryID, key] = stored.id.split("/");
    const next = Zotero.Items.getByLibraryAndKey(Number(libraryID), key)!;
    created.push(next);
    assert.notEqual(next.id, note.id);
    assert.equal(next.libraryID, item.libraryID);
    assert.equal(next.parentID, item.id);
    assert.equal(
      next.getNote(),
      "<h1>Water plants weekly</h1>" +
        "<p>[ ] 🔁 every week 📅 2026-10-27 ⏳ 2026-10-26 see [[Garden]]</p>",
    );
  });

  it("refuses the next occurrence when its item is in the trash", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Trashed paper");
    await item.saveTx({ skipSelect: true } as any);
    created.push(item);
    const note = await mutations.addTaskForItem(item, {
      title: "Weekly reading",
      dueAt: "2026-10-20",
      recurringInterval: "every week",
    });
    created.push(note);
    const current = taskFor(note);
    item.deleted = true;
    await item.saveTx({ skipSelect: true } as any);

    let message = "";
    await mutations
      .addTask({ ...current, id: "ai-next", dueAt: "2026-10-27" })
      .catch((e: Error) => (message = e.message));
    assert.isNotEmpty(message);
    assert.notExists(
      store
        .getTasks()
        .find((t: any) => t.title === "Weekly reading" && t.id !== current.id),
    );
  });

  it("makes edits undoable from Zotero", async function () {
    const note = await createNote("<p>Undo me</p><p>[ ]</p>");
    const before = taskFor(note);
    await mutations.updateTask({ ...before, status: "done" }, before);
    assert.include(note.getNote(), "[x]");
    assert.deepInclude(Zotero.UndoHistory.getUndoAction(), {
      action: `${config.addonRef}-undo-edit-task`,
    });
    assert.isTrue(await Zotero.UndoHistory.undo());
    assert.include(flat(Zotero.Items.get(note.id).getNote()), "<p>[ ]</p>");
  });

  it("moves deleted tasks to the trash", async function () {
    const note = await createNote("<p>Trash me</p>");
    await mutations.deleteTask(taskFor(note).id, taskFor(note));
    assert.isTrue(Zotero.Items.get(note.id).deleted);
    assert.notExists(store.getTasks().find((t: any) => t.title === "Trash me"));
  });

  it("refuses to edit tasks in read-only libraries", async function () {
    const note = await createNote("<p>Locked</p>");
    const task = taskFor(note);
    // My Library can't be made read-only, so stand in a read-only group.
    const libraries = Zotero.Libraries as any;
    const realGet = libraries.get;
    libraries.get = (id: number) =>
      id === note.libraryID
        ? { libraryID: id, name: "Locked Group", editable: false }
        : realGet.call(libraries, id);
    try {
      let message = "";
      await mutations
        .updateTask({ ...task, title: "Changed" }, task)
        .catch((e: Error) => (message = e.message));
      assert.include(message, "Locked Group");
      assert.include(note.getNote(), "Locked");
    } finally {
      libraries.get = realGet;
    }
  });

  // Regression: an open note editor's delayed re-save overwrote later edits.
  it("keeps every edit while the note is open in the editor", async function () {
    const note = await createNote("<p>Open in editor</p><p>[ ]</p>");
    await Zotero.getMainWindow().ZoteroPane.selectItem(note.id);
    await delay(1000);

    let task = taskFor(note);
    await mutations.updateTask({ ...task, priority: "high" }, task);
    task = taskFor(note);
    await mutations.updateTask({ ...task, dueAt: "2026-12-01" }, task);
    task = taskFor(note);
    await mutations.updateTask(
      { ...task, description: "typed from the timeline" },
      task,
    );

    await delay(2500);
    assert.equal(
      flat(Zotero.Items.get(note.id).getNote()),
      "<p>Open in editor</p><p>[ ] ⏫ 📅 2026-12-01</p><p>typed from the timeline</p>",
    );
  });

  it("reports a missing note instead of failing silently", async function () {
    const note = await createNote("<p>Gone</p>");
    const task = taskFor(note);
    await note.eraseTx();
    let message = "";
    await mutations
      .updateTask(task, task)
      .catch((e: Error) => (message = e.message));
    assert.isNotEmpty(message);
  });

  it("adds a child task for an item", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Attention Is All You Need");
    await item.saveTx();
    created.push(item);
    const note = await mutations.addTaskForItem(item);
    created.push(note);
    assert.equal(note.parentID, item.id);
    assert.include(taskFor(note).extra, { parentKey: item.key });
    assert.include(note.getNote(), "Attention Is All You Need");
  });

  it("reveals a task's note in the library", async function () {
    const note = await createNote("<p>Reveal me</p>");
    await mutations.revealTask(taskFor(note));
    const selected = Zotero.getMainWindow().ZoteroPane.getSelectedItems();
    assert.deepEqual(
      selected.map((i: Zotero.Item) => i.id),
      [note.id],
    );
  });
});
