/**
 * Read-only Zotero library tools for the timeline's AI agent. They run in the
 * plugin core; the UI exposes them to the agent through the AI bridge.
 *
 * Items are referenced as "libraryID/KEY", the same form as task ids.
 */
import { parseTaskId } from "../tasks/noteFormat";
import { getTaskTag } from "../settings/zoteroPrefs";
import {
  capText,
  chunkText,
  intArg,
  requiredStringArg,
  stringArg,
} from "./toolOutput";

export interface LibraryAccess {
  abstracts: boolean;
  annotations: boolean;
  fulltext: boolean;
}

export interface HostToolDescriptor {
  name: string;
  description: string;
  schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

interface HostTool extends HostToolDescriptor {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

const MAX_SEARCH_RESULTS = 25;
const MAX_ANNOTATIONS = 100;
const MAX_FULLTEXT_CHUNK = 8000;

// Zotero 10 selection APIs that zotero-types doesn't describe yet.
interface Zotero10Pane {
  getSelectedLibraryIDs?: () => number[];
  getSelectedCollections?: () => Zotero.Collection[];
  getSelectedItems: () => Zotero.Item[];
}

const refOf = (item: Zotero.Item) => `${item.libraryID}/${item.key}`;

function libraryName(libraryID: number): string {
  const library = Zotero.Libraries.get(libraryID);
  return library ? library.name : `Library ${libraryID}`;
}

function creatorNames(item: Zotero.Item, max: number): string[] {
  return item
    .getCreators()
    .slice(0, max)
    .map(
      (c) =>
        [c.lastName, c.firstName].filter(Boolean).join(", ") || "(unnamed)",
    );
}

function yearOf(item: Zotero.Item): string | undefined {
  const date = item.getField("date") as string;
  return date ? Zotero.Date.strToDate(date).year?.toString() : undefined;
}

function summarize(item: Zotero.Item) {
  return {
    ref: refOf(item),
    title: capText(item.getDisplayTitle(), 300),
    itemType: Zotero.ItemTypes.getName(item.itemTypeID),
    creators: creatorNames(item, 3),
    year: yearOf(item),
    library: libraryName(item.libraryID),
    tags: item
      .getTags()
      .slice(0, 10)
      .map((t) => t.tag),
  };
}

function resolveItem(ref: string): Zotero.Item {
  const { libraryID, key } = parseTaskId(ref);
  const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!item || item.deleted) {
    throw new Error(`No item ${ref} in the library`);
  }
  return item;
}

/** The regular item and its PDF/EPUB/snapshot attachments for a ref. */
function attachmentsFor(item: Zotero.Item): Zotero.Item[] {
  if (item.isAttachment()) return [item];
  if (!item.isRegularItem()) {
    throw new Error(`${refOf(item)} is not a regular item or attachment`);
  }
  return Zotero.Items.get(item.getAttachments()).filter((a) =>
    a.isFileAttachment(),
  );
}

function requireAccess(allowed: boolean, what: string): void {
  if (!allowed) {
    throw new Error(
      `Reading ${what} is turned off. The user can allow it in the timeline's Settings → Zotero tab.`,
    );
  }
}

export function createLibraryTools(getAccess: () => LibraryAccess): HostTool[] {
  return [
    {
      name: "get_current_context",
      description:
        "What the user is looking at in Zotero right now: the open tab, the selected library and collections, and the selected items (or the item open in the reader).",
      schema: { type: "object", properties: {} },
      execute: async () => {
        const win = Zotero.getMainWindow();
        const tabs = win.Zotero_Tabs;
        if (tabs.selectedType.startsWith("reader")) {
          const reader = Zotero.Reader.getByTabID(tabs.selectedID);
          const attachment = reader ? Zotero.Items.get(reader.itemID!) : false;
          const parent = attachment ? attachment.parentItem : undefined;
          return {
            tab: "reader",
            openItem: parent
              ? summarize(parent)
              : attachment && summarize(attachment),
          };
        }
        const pane = win.ZoteroPane as unknown as Zotero10Pane;
        if (!pane.getSelectedLibraryIDs || !pane.getSelectedCollections) {
          throw new Error(
            "This Zotero version lacks the Zotero 10 selection API",
          );
        }
        const items = pane.getSelectedItems();
        return {
          tab: "library",
          libraries: pane.getSelectedLibraryIDs().map(libraryName),
          collections: pane.getSelectedCollections().map((c) => c.name),
          selectedItems: items
            .filter((item) => item.isRegularItem())
            .slice(0, 20)
            .map(summarize),
          selectedCount: items.length,
        };
      },
    },
    {
      name: "search_library",
      description:
        "Search Zotero items by title, creator or year, optionally limited to a library, collection or tag. Returns item refs for get_item.",
      schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Words to match in title, creators or year",
          },
          library: { type: "string", description: "Library name to search" },
          collection: { type: "string", description: "Collection name" },
          tag: { type: "string", description: "Only items with this tag" },
          limit: {
            type: "number",
            description: `Maximum results (1-${MAX_SEARCH_RESULTS}, default 10)`,
          },
        },
      },
      execute: async (args) => {
        const query = stringArg(args.query, "query");
        const libraryFilter = stringArg(args.library, "library");
        const collectionName = stringArg(args.collection, "collection");
        const tag = stringArg(args.tag, "tag");
        const limit = intArg(args.limit, {
          min: 1,
          max: MAX_SEARCH_RESULTS,
          fallback: 10,
        });
        if (!query && !collectionName && !tag) {
          throw new Error("Give a query, a collection or a tag");
        }
        const libraries = Zotero.Libraries.getAll().filter(
          (l) =>
            l.libraryType !== "feed" &&
            (!libraryFilter || l.name === libraryFilter),
        );
        if (libraryFilter && libraries.length === 0) {
          throw new Error(`No library named "${libraryFilter}"`);
        }

        const results: Zotero.Item[] = [];
        let collectionFound = !collectionName;
        for (const library of libraries) {
          const search = new Zotero.Search();
          // Zotero assigns libraryID on new searches; zotero-types marks it readonly.
          (search as unknown as { libraryID: number }).libraryID =
            library.libraryID;
          if (query) {
            search.addCondition(
              "quicksearch-titleCreatorYear",
              "contains",
              query,
            );
          }
          if (tag) search.addCondition("tag", "is", tag);
          if (collectionName) {
            const collection = Zotero.Collections.getByLibrary(
              library.libraryID,
              true,
            ).find((c) => c.name === collectionName);
            if (!collection) continue;
            collectionFound = true;
            search.addCondition("collection", "is", collection.key);
          }
          const ids = await search.search();
          const items = await Zotero.Items.getAsync(ids);
          results.push(...items.filter((i) => i.isRegularItem() && !i.deleted));
        }
        if (!collectionFound) {
          throw new Error(`No collection named "${collectionName}"`);
        }
        return {
          total: results.length,
          items: results.slice(0, limit).map(summarize),
        };
      },
    },
    {
      name: "get_item",
      description:
        "Details of one Zotero item: bibliographic fields, abstract (if the user allowed it), collections, attachments, and its task notes.",
      schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: 'Item ref, e.g. "1/ABCD2345"' },
        },
        required: ["ref"],
      },
      execute: async (args) => {
        const item = resolveItem(requiredStringArg(args.ref, "ref"));
        if (!item.isRegularItem()) {
          throw new Error(`${refOf(item)} is not a regular item`);
        }
        const access = getAccess();
        // getField returns "" for fields this item type doesn't have.
        const field = (name: string) =>
          (item.getField(name) as string) || undefined;
        const abstract = field("abstractNote");
        const taskTag = getTaskTag();
        const notes = Zotero.Items.get(item.getNotes());
        return {
          ...summarize(item),
          creators: creatorNames(item, 20),
          date: field("date"),
          publication: field("publicationTitle"),
          doi: field("DOI"),
          url: field("url"),
          abstract: abstract
            ? access.abstracts
              ? capText(abstract, 4000)
              : "(not shared: the user hasn't allowed reading abstracts)"
            : undefined,
          collections: Zotero.Collections.get(item.getCollections()).map(
            (c) => c.name,
          ),
          attachments: attachmentsFor(item).map((a) => ({
            ref: refOf(a),
            title: a.getDisplayTitle(),
            contentType: a.attachmentContentType,
          })),
          noteCount: notes.length,
          taskNotes: notes
            .filter((n) => n.hasTag(taskTag))
            .map((n) => ({ ref: refOf(n), title: n.getNoteTitle() })),
        };
      },
    },
    {
      name: "get_annotations",
      description:
        "Highlights and comments the user made in an item's PDFs/EPUBs (or in one attachment). Only works if the user allowed reading annotations.",
      schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Item or attachment ref" },
          limit: {
            type: "number",
            description: `Maximum annotations (1-${MAX_ANNOTATIONS}, default 50)`,
          },
        },
        required: ["ref"],
      },
      execute: async (args) => {
        requireAccess(getAccess().annotations, "annotations");
        const item = resolveItem(requiredStringArg(args.ref, "ref"));
        const limit = intArg(args.limit, {
          min: 1,
          max: MAX_ANNOTATIONS,
          fallback: 50,
        });
        const annotations = attachmentsFor(item).flatMap((attachment) =>
          attachment.getAnnotations().map((a) => ({
            attachment: attachment.getDisplayTitle(),
            type: a.annotationType,
            text: a.annotationText ? capText(a.annotationText, 500) : undefined,
            comment: a.annotationComment
              ? capText(a.annotationComment, 500)
              : undefined,
            page: a.annotationPageLabel || undefined,
            color: a.annotationColor || undefined,
          })),
        );
        return {
          total: annotations.length,
          annotations: annotations.slice(0, limit),
        };
      },
    },
    {
      name: "get_fulltext",
      description:
        "Read the full text of an item's first readable attachment (or one attachment), in chunks. Only works if the user allowed reading full text. Call again with nextOffset for more.",
      schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Item or attachment ref" },
          offset: {
            type: "number",
            description: "Character offset, default 0",
          },
          maxChars: {
            type: "number",
            description: `Chunk size (500-${MAX_FULLTEXT_CHUNK}, default 4000)`,
          },
        },
        required: ["ref"],
      },
      execute: async (args) => {
        requireAccess(getAccess().fulltext, "full text");
        const item = resolveItem(requiredStringArg(args.ref, "ref"));
        const offset = intArg(args.offset, {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
          fallback: 0,
        });
        const maxChars = intArg(args.maxChars, {
          min: 500,
          max: MAX_FULLTEXT_CHUNK,
          fallback: 4000,
        });
        for (const attachment of attachmentsFor(item)) {
          const text = await attachment.attachmentText;
          if (text) {
            return {
              attachment: {
                ref: refOf(attachment),
                title: attachment.getDisplayTitle(),
              },
              ...chunkText(text, offset, maxChars),
            };
          }
        }
        throw new Error(
          `No readable text in ${refOf(item)}'s attachments (missing files or not indexed)`,
        );
      },
    },
  ];
}
