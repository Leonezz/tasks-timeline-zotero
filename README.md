# Tasks Timeline for Zotero

Plan reading and research tasks on a timeline inside Zotero. Shares its UI with
the Obsidian plugin through
[`@tasks-timeline/components`](https://github.com/Leonezz/tasks-timeline-components).

Requires Zotero 10.

## Install

1. Download the latest `tasks-timeline.xpi` from
   [Releases](https://github.com/Leonezz/tasks-timeline-zotero/releases/latest).
2. In Zotero 10: Tools → Plugins → gear menu → Install Plugin From File…,
   then pick the downloaded file.
3. Open the timeline with the toolbar button next to the search box (or
   View → Tasks Timeline Sidebar).

Installed copies update themselves when a new version is released.

## Features

The sidebar shows every task note from My Library and group libraries,
and edits made in the timeline are written back to the notes.

- Toggle the sidebar with the toolbar button next to the search box or
  View → Tasks Timeline Sidebar.
- New tasks from the timeline go to My Library. Right-click an item →
  "Add Task for This Item" creates a child task note and opens it.
- Completing a recurring task creates its next occurrence next to it: in the
  same library, under the same item, with its ⏳ date moved and the notes
  after its fields kept.
- Edits change only the title line, the metadata line, the tags, and the
  description when you edit it; the rest of the note keeps its formatting.
  Within those lines, only what changed is rewritten: fields the timeline
  doesn't show (🏁 🆔 ⛔), notes and links after the fields, ⏰ reminders and
  block ids stay as written, and a line the edit doesn't change keeps its
  formatting.
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

## MCP (external AI agents)

Settings → Zotero → "Allow MCP clients" serves the task and library tools to
MCP clients on this computer, such as Claude Code or Claude Desktop, at
`http://127.0.0.1:<Zotero port>/taskstimeline/mcp` (Streamable HTTP, JSON
responses). It is off by default.

- Every request needs the bearer token shown in the settings (stored in the
  login manager; regenerating it locks out the old one immediately). Zotero
  only accepts localhost requests and ignores requests from web pages.
- Clients get the task tools that don't need confirmation and the library
  tools, within the same read permissions as the sidebar assistant.
  Deleting tasks, batch updates and turning annotations into tasks aren't
  offered, since nobody is there to confirm them.
- "Copy setup command" puts a ready-made `claude mcp add …` command on the
  clipboard.

## Task notes

A task is a Zotero note tagged `#task`:

```
Read Attention paper                      ← title (first line)
[ ] ⏫ 📅 2026-10-20 🛫 2026-10-15         ← optional metadata line
Focus on section 3.                       ← description
```

- Metadata uses the Obsidian Tasks syntax: `[ ]` todo, `[/]` doing, `[x]`
  done, `[-]` cancelled; 📅 due, 🛫 start, ⏳ scheduled, ➕ created, ✅ done,
  ❌ cancelled, 🔁 recurrence, ⏫/🔼/🔽 priority, 🏁 on completion, 🆔 id,
  ⛔ depends on. Metadata typed on the title line also works, and stays
  there when the task is edited.
- Recurrence is stored as Obsidian Tasks text (`🔁 every week on Monday`).
  A rule can't hold its own start date; use the task's 🛫 start date. The
  task editor and the AI tools refuse rules a note can't hold.
- Rules that version 0.1.0 saved with a start date
  (`🔁 DTSTART:… RRULE:…`) are repaired the next time the task is edited:
  the start date moves to 🛫 and the rule is written as text. If that isn't
  possible (for example the note already has a different 🛫 date), the edit
  is refused with instructions for fixing the note by hand.
- Other tags on the note become task tags. The library name is the category.
- Child notes are tasks about their parent item.
- The plugin never edits item metadata such as `date` or `Extra`.

## Architecture

- `src/index.ts`, `src/hooks.ts`: plugin core in the bootstrap sandbox
- `src/modules/`: Zotero integration (sidebar, menu)
- `src/mcp/`: MCP server — `protocol.ts` (pure JSON-RPC handling, unit
  tested), `mcpTools.ts` (which tools are offered), `mcpServer.ts` (endpoint,
  token auth)
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
