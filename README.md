# Tasks Timeline for Zotero

Plan reading and research tasks on a timeline inside Zotero. Shares its UI with
the Obsidian plugin through
[`@tasks-timeline/components`](https://github.com/Leonezz/tasks-timeline-components).

Requires Zotero 10.

## Status

M2: the sidebar shows every task note from My Library and group libraries,
and edits made in the timeline are written back to the notes.

- Toggle the sidebar with the toolbar button next to the search box or
  View → Tasks Timeline Sidebar.
- New tasks from the timeline go to My Library. Right-click an item →
  "Add Task for This Item" creates a child task note and opens it.
- Edits change only the title line, the metadata line, the tags, and the
  description when you edit it; the rest of the note keeps its formatting.
- Edits and moving a task to the trash can be undone with Zotero's Undo.
  Zotero declines an undo if the note was saved again since (for example by
  an open note editor reformatting it).
- Tasks in read-only group libraries are shown but can't be edited.
- Clicking a task's metadata row selects its note in the library.

## Settings and AI

- Timeline settings are saved in Zotero's prefs. API keys are kept in
  Firefox's login manager (protected by your primary password if you set
  one), never in prefs.js.
- Settings → Zotero sets the task tag (default `#task`).
- The AI assistant (AI entry in the input bar) can create, update, complete
  and delete tasks. It asks before deleting or changing view settings. It
  knows it runs in Zotero and which libraries are read-only. Any provider
  supported by the timeline works, including OpenAI-compatible local models.
- The assistant can also read your library: what you have selected, search by
  title/creator/year, tag or collection, and item details. Titles, creators,
  years and tags are always available to it; abstracts, annotations and full
  text are only shared with your AI provider if you allow them in
  Settings → Zotero (all off by default).
- It can create tasks about a specific item (child notes), and turn to-do
  annotations (TODO, `[ ]`, 待办 …, or a keyword) into tasks. For the
  latter you review the proposals in a dialog and pick which to create;
  nothing is written until you confirm, and annotations that already became
  tasks are skipped.
- Voice input starts disabled: Zotero's engine has no browser speech
  recognition, so only the OpenAI/Gemini transcription providers can work.

## Task notes

A task is a Zotero note tagged `#task`:

```
Read Attention paper                      ← title (first line)
[ ] ⏫ 📅 2026-10-20 🛫 2026-10-15         ← optional metadata line
Focus on section 3.                       ← description
```

- Metadata uses the Obsidian Tasks syntax: `[ ]` todo, `[/]` doing, `[x]`
  done, `[-]` cancelled; 📅 due, 🛫 start, ⏳ scheduled, ➕ created, ✅ done,
  🔁 recurrence, ⏫/🔼/🔽 priority. Metadata typed on the title line also works.
- Other tags on the note become task tags. The library name is the category.
- Child notes are tasks about their parent item.
- The plugin never edits item metadata such as `date` or `Extra`.

## Architecture

- `src/index.ts`, `src/hooks.ts`: plugin core in the bootstrap sandbox
- `src/modules/`: Zotero integration (sidebar, menu)
- `src/ai/`: the agent's Zotero context — system prompt and read-only
  library tools (`libraryTools.ts`), exposed to the UI through `aiBridge.ts`
- `src/tasks/`: task notes — `noteFormat.ts` (pure note ⇄ task mapping, unit
  tested), `noteBlocks.ts` (note HTML → text blocks), `noteEditing.ts` (edit
  note HTML in place), `taskStore.ts` (library queries + Notifier refresh),
  `taskMutations.ts` (the only write path: permissions, undo labels, and
  coordination with open note editors)
- `src/ui/`: React app, built as a separate IIFE bundle and loaded by
  `addon/content/timeline.html` inside the sidebar iframe
- `src/shared/uiContract.ts`: the interface between core and UI

The UI must not run directly in the main window: it is a XUL document without
`document.body`, which framer-motion, Radix and Floating UI all assume. The
iframe also hides `frameElement` so Floating UI does not walk back into the
XUL document (see `src/ui/index.tsx`).

## Development

```bash
pnpm install
cp .env.example .env   # then fill in absolute paths
pnpm start             # builds, launches Zotero with a dev profile, hot-reloads
pnpm build             # production build + type check
pnpm test:unit              # Node unit tests (vitest, unit/)
pnpm test --exit-on-finish  # Zotero integration tests (test/), throwaway profile
```

Use a dedicated profile and data directory. Always set
`ZOTERO_PLUGIN_KILL_COMMAND` as shown in `.env.example`: the scaffold's macOS
default force-kills every Zotero process, including your everyday instance.

Zotero debug output goes to `.scaffold/logs/`.
