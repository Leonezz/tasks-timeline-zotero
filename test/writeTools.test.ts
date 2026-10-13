import { assert } from "chai";
import { config } from "../package.json";
import { createAnnotatedPaper } from "./helpers";

const PREFS = config.prefsPrefix;

describe("AI write tools", function () {
  this.timeout(30000);

  let ai: any;
  const created: Zotero.Item[] = [];

  const ref = (item: Zotero.Item) => `${item.libraryID}/${item.key}`;
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected a failure");
      },
      (e: Error) => e.message,
    );
  const childTasks = (item: Zotero.Item) =>
    Zotero.Items.get(item.getNotes()).filter((n) => n.hasTag("#task"));
  const setAnnotationAccess = (allowed: boolean) =>
    Zotero.Prefs.set(`${PREFS}.aiReadAnnotations`, allowed, true);

  before(function () {
    // @ts-expect-error - Plugin instance is not typed
    ai = Zotero[config.addonInstance].data.aiBridge;
  });

  after(async function () {
    setAnnotationAccess(false);
    for (const item of created.reverse()) {
      if (Zotero.Items.get(item.id)) await item.eraseTx();
    }
  });

  describe("create_task_for_item", function () {
    let paper: Zotero.Item;

    before(async function () {
      paper = new Zotero.Item("book");
      paper.libraryID = Zotero.Libraries.userLibraryID;
      paper.setField("title", "Deep Learning (write tools test)");
      await paper.saveTx({ skipSelect: true } as any);
      created.push(paper);
    });

    it("creates a child task note with dates, priority and tags", async function () {
      const result = await ai.executeTool("create_task_for_item", {
        ref: ref(paper),
        title: "Read chapter 6",
        dueAt: "2026-11-01",
        priority: "high",
        tags: ["reading"],
      });
      assert.equal(result.item, ref(paper));
      const [note] = childTasks(paper);
      assert.equal(result.taskId, ref(note));
      assert.equal(
        note.getNote(),
        "<h1>Read chapter 6</h1><p>[ ] ⏫ 📅 2026-11-01</p>",
      );
      assert.sameMembers(
        note.getTags().map((t) => t.tag),
        ["#task", "reading"],
      );
    });

    it("rejects bad arguments with a clear message", async function () {
      const run = (args: object) =>
        failure(ai.executeTool("create_task_for_item", args));
      assert.match(
        await run({ ref: ref(paper), title: "x", dueAt: "next week" }),
        /must be a date/,
      );
      assert.match(
        await run({ ref: ref(paper), title: "x", priority: "urgent" }),
        /must be one of/,
      );
      assert.match(await run({ ref: ref(paper) }), /"title" is required/);
      assert.match(
        await run({ ref: ref(childTasks(paper)[0]), title: "x" }),
        /not a regular item/,
      );
    });

    it("refuses read-only libraries", async function () {
      const libraries = Zotero.Libraries as any;
      const realGet = libraries.get;
      libraries.get = (id: number) =>
        id === paper.libraryID
          ? { libraryID: id, name: "Locked Group", editable: false }
          : realGet.call(libraries, id);
      try {
        assert.match(
          await failure(
            ai.executeTool("create_task_for_item", {
              ref: ref(paper),
              title: "Should not exist",
            }),
          ),
          /Locked Group/,
        );
      } finally {
        libraries.get = realGet;
      }
      assert.notInclude(
        childTasks(paper).map((n) => n.getNoteTitle()),
        "Should not exist",
      );
    });
  });

  describe("tasks_from_annotations", function () {
    let paper: Zotero.Item;

    before(async function () {
      ({ paper } = await createAnnotatedPaper("Annotated (write tools test)", [
        {
          text: "multi-head attention",
          comment: "TODO: compare with RNNs",
          page: "3",
        },
        { text: "just a highlight", comment: "nice", page: "4" },
        { comment: "待办：复现实验", page: "5" },
      ]));
      created.push(paper);
    });

    it("needs annotation access", async function () {
      setAnnotationAccess(false);
      assert.match(
        await failure(
          ai.prepareTool("tasks_from_annotations", { ref: ref(paper) }),
        ),
        /annotations is turned off/,
      );
    });

    it("can't be run without the user's review", async function () {
      assert.match(
        await failure(
          ai.executeTool("tasks_from_annotations", { ref: ref(paper) }),
        ),
        /needs the user's confirmation/,
      );
    });

    it("proposes tasks, creates only the chosen ones, and never duplicates", async function () {
      setAnnotationAccess(true);
      const plan = await ai.prepareTool("tasks_from_annotations", {
        ref: ref(paper),
        dueAt: "2026-11-15",
      });
      assert.deepEqual(
        plan.choices.map((c: any) => c.label),
        ["compare with RNNs", "复现实验"],
      );
      assert.equal(plan.summary.annotationsChecked, 3);
      assert.lengthOf(childTasks(paper), 0, "nothing written while preparing");

      const result = await ai.commitTool(plan.token, [0]);
      assert.include(result, { created: 1, declined: 1, alreadyTasks: 0 });
      const [note] = childTasks(paper);
      assert.include(note.getNote(), "compare with RNNs");
      assert.include(note.getNote(), "[ ] 📅 2026-11-15");
      assert.include(
        note.getNote(),
        "From an annotation on p. 3: “multi-head attention”",
      );

      const again = await ai.prepareTool("tasks_from_annotations", {
        ref: ref(paper),
      });
      assert.deepEqual(
        again.choices.map((c: any) => c.label),
        ["复现实验"],
      );
      assert.equal(again.summary.alreadyTasks, 1);
    });

    it("uses each plan once and validates the selection", async function () {
      const plan = await ai.prepareTool("tasks_from_annotations", {
        ref: ref(paper),
      });
      assert.match(
        await failure(ai.commitTool(plan.token, [5])),
        /doesn't match/,
      );
      assert.match(
        await failure(ai.commitTool(plan.token, [0])),
        /expired or was already used/,
      );
      assert.match(
        await failure(ai.commitTool("not-a-token", [0])),
        /expired or was already used/,
      );
    });
  });
});
