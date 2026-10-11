# Tasks Timeline for Zotero

Plan reading and research tasks on a timeline inside Zotero. Shares its UI with
the Obsidian plugin through
[`@tasks-timeline/components`](https://github.com/Leonezz/tasks-timeline-components).

Requires Zotero 10.

## Status

M0 (spike): the timeline opens in its own tab (View → Tasks Timeline) and keeps
tasks in memory for the session only. Reading and writing Zotero notes comes in
M1/M2.

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
- `src/modules/`: Zotero integration (menu, tab)
- `src/ui/`: React app, built as a separate IIFE bundle and loaded into the
  main window so React sees real DOM globals; rendered in a Shadow DOM
- `src/shared/uiContract.ts`: the interface between core and UI

## Development

```bash
pnpm install
cp .env.example .env   # then fill in absolute paths
pnpm start             # builds, launches Zotero with a dev profile, hot-reloads
pnpm build             # production build + type check
```

Use a dedicated profile and data directory. Always set
`ZOTERO_PLUGIN_KILL_COMMAND` as shown in `.env.example`: the scaffold's macOS
default force-kills every Zotero process, including your everyday instance.

Zotero debug output goes to `.scaffold/logs/`.
