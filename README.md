# Tasks Timeline for Zotero

Plan reading and research tasks on a timeline inside Zotero. Shares its UI with
the Obsidian plugin through
[`@tasks-timeline/components`](https://github.com/Leonezz/tasks-timeline-components).

Requires Zotero 10.

## Status

M0 (spike): the timeline lives in a sidebar to the right of the item pane in
the library tab. Toggle it with the toolbar button next to the search box or
View → Tasks Timeline Sidebar. Tasks are kept in memory for the session only;
reading and writing Zotero notes comes in M1/M2.

## Task model (from M1)

A task is a Zotero note carrying the task tag (default `#task`):

- first line: task title
- second line: Obsidian Tasks style metadata, e.g.
  `📅 2026-10-20 🛫 2026-10-15 ⏫`
- other note tags: task tags
- child note: task attached to that item; standalone note: free task

The plugin never edits item metadata such as `date` or `Extra`.

## Architecture

- `src/index.ts`, `src/hooks.ts`: plugin core in the bootstrap sandbox
- `src/modules/`: Zotero integration (sidebar, menu)
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
pnpm test --exit-on-finish  # integration tests in a throwaway Zotero profile
```

Use a dedicated profile and data directory. Always set
`ZOTERO_PLUGIN_KILL_COMMAND` as shown in `.env.example`: the scaffold's macOS
default force-kills every Zotero process, including your everyday instance.

Zotero debug output goes to `.scaffold/logs/`.
