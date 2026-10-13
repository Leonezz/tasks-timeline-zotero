import { assert } from "chai";
import { config } from "../package.json";
import { importFile, MINIMAL_PDF } from "./helpers";

const PREFS = config.prefsPrefix;

// Smallest file Zotero recognizes as a PDF; annotations don't need real pages.
const MINIMAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n";

const FULLTEXT = "Attention is all you need. ".repeat(300);

describe("library tools", function () {
  this.timeout(30000);

  let ai: any;
  let paper: Zotero.Item;
  let collection: Zotero.Collection;
  const created: Zotero.DataObject[] = [];

  const ref = (item: Zotero.Item) => `${item.libraryID}/${item.key}`;
  const run = (name: string, args: object = {}) => ai.executeTool(name, args);
  const failure = (name: string, args: object = {}) =>
    run(name, args).then(
      () => {
        throw new Error(`${name} should have failed`);
      },
      (e: Error) => e.message,
    );
  const setAccess = (
    abstracts: boolean,
    annotations: boolean,
    fulltext: boolean,
  ) => {
    Zotero.Prefs.set(`${PREFS}.aiReadAbstracts`, abstracts, true);
    Zotero.Prefs.set(`${PREFS}.aiReadAnnotations`, annotations, true);
    Zotero.Prefs.set(`${PREFS}.aiReadFulltext`, fulltext, true);
  };

  before(async function () {
    // @ts-expect-error - Plugin instance is not typed
    ai = Zotero[config.addonInstance].data.aiBridge;
    assert.exists(ai, "AI bridge");

    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Reading List (tools test)";
    await collection.saveTx();
    created.push(collection);

    paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title", "Attention Is All You Need (tools test)");
    paper.setField("date", "2017-06-12");
    paper.setField("publicationTitle", "NeurIPS");
    paper.setField("abstractNote", "We propose the Transformer.");
    paper.setCreators([
      { firstName: "Ashish", lastName: "Vaswani", creatorType: "author" },
    ]);
    paper.addTag("transformers-test");
    paper.addToCollection(collection.id);
    await paper.saveTx({ skipSelect: true } as any);
    created.push(paper);

    const pdf = await importFile("tools-test.pdf", MINIMAL_PDF, paper.id);
    const annotation = new Zotero.Item("annotation") as any;
    annotation.libraryID = pdf.libraryID;
    annotation.parentID = pdf.id;
    annotation.annotationType = "highlight";
    annotation.annotationText = "multi-head attention";
    annotation.annotationComment = "TODO: compare with RNNs";
    annotation.annotationColor = "#ffd400";
    annotation.annotationPageLabel = "3";
    annotation.annotationSortIndex = "00002|000000|00000";
    annotation.annotationPosition = JSON.stringify({
      pageIndex: 2,
      rects: [[10, 10, 50, 20]],
    });
    await annotation.saveTx();

    await importFile("tools-test.txt", FULLTEXT, paper.id);

    const task = new Zotero.Item("note");
    task.libraryID = Zotero.Libraries.userLibraryID;
    task.parentID = paper.id;
    task.setNote("<p>Read the paper</p><p>[ ]</p>");
    task.addTag("#task");
    await task.saveTx({ skipSelect: true } as any);
  });

  after(async function () {
    setAccess(false, false, false);
    for (const object of created.reverse()) await object.eraseTx();
  });

  it("finds items by title words, tag and collection", async function () {
    const byQuery = await run("search_library", { query: "Attention Is All" });
    assert.include(
      byQuery.items.map((i: any) => i.ref),
      ref(paper),
    );

    const byTag = await run("search_library", { tag: "transformers-test" });
    assert.deepEqual(
      byTag.items.map((i: any) => i.ref),
      [ref(paper)],
    );

    const byCollection = await run("search_library", {
      collection: "Reading List (tools test)",
    });
    assert.deepEqual(
      byCollection.items.map((i: any) => i.ref),
      [ref(paper)],
    );
    assert.include(byCollection.items[0], {
      title: "Attention Is All You Need (tools test)",
      year: "2017",
      itemType: "journalArticle",
    });
    assert.deepEqual(byCollection.items[0].creators, ["Vaswani, Ashish"]);
  });

  it("explains bad searches instead of returning nothing", async function () {
    assert.match(
      await failure("search_library", {}),
      /query, a collection or a tag/,
    );
    assert.match(
      await failure("search_library", { collection: "No such collection" }),
      /No collection named/,
    );
    assert.match(
      await failure("search_library", { query: "x", library: "Nope" }),
      /No library named/,
    );
  });

  it("returns item details and hides the abstract unless allowed", async function () {
    setAccess(false, false, false);
    let item = await run("get_item", { ref: ref(paper) });
    assert.include(item, { publication: "NeurIPS", date: "2017-06-12" });
    assert.match(item.abstract, /not shared/);
    assert.deepEqual(item.collections, ["Reading List (tools test)"]);
    assert.sameMembers(
      item.attachments.map((a: any) => a.contentType),
      ["application/pdf", "text/plain"],
    );
    assert.deepEqual(
      item.taskNotes.map((n: any) => n.title),
      ["Read the paper"],
    );

    setAccess(true, false, false);
    item = await run("get_item", { ref: ref(paper) });
    assert.equal(item.abstract, "We propose the Transformer.");
  });

  it("reads annotations only when allowed", async function () {
    setAccess(false, false, false);
    assert.match(
      await failure("get_annotations", { ref: ref(paper) }),
      /annotations is turned off/,
    );

    setAccess(false, true, false);
    const result = await run("get_annotations", { ref: ref(paper) });
    assert.equal(result.total, 1);
    assert.include(result.annotations[0], {
      type: "highlight",
      text: "multi-head attention",
      comment: "TODO: compare with RNNs",
      page: "3",
    });
  });

  it("reads full text in chunks only when allowed", async function () {
    setAccess(false, false, false);
    assert.match(
      await failure("get_fulltext", { ref: ref(paper) }),
      /full text is turned off/,
    );

    setAccess(false, false, true);
    const first = await run("get_fulltext", {
      ref: ref(paper),
      maxChars: 1000,
    });
    assert.equal(first.text.length, 1000);
    assert.isAbove(first.totalChars, 5000);
    assert.equal(first.nextOffset, 1000);
    const next = await run("get_fulltext", {
      ref: ref(paper),
      offset: first.nextOffset,
      maxChars: 1000,
    });
    assert.equal(next.offset, 1000);
    assert.include(next.text, "Attention");
  });

  it("rejects unknown refs and tools", async function () {
    assert.match(await failure("get_item", { ref: "1/ZZZZZZZZ" }), /No item/);
    assert.match(await failure("get_item", { ref: "nonsense" }), /Malformed/);
    assert.match(await failure("delete_everything"), /Unknown Zotero tool/);
  });

  it("reports what the user has selected", async function () {
    const win = Zotero.getMainWindow() as any;
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.selectItem(paper.id);
    const context = await run("get_current_context");
    assert.equal(context.tab, "library");
    assert.deepEqual(
      context.selectedItems.map((i: any) => i.ref),
      [ref(paper)],
    );
  });
});
