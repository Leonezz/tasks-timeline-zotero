import { getTaskTag } from "../settings/zoteroPrefs";

/**
 * Host context appended to the timeline agent's system prompt so it knows
 * where tasks live and what it can't change.
 */
export function zoteroSystemPrompt(): string {
  const libraries = Zotero.Libraries.getAll().filter(
    (library) => library.libraryType !== "feed",
  );
  const readOnly = libraries.filter((library) => !library.editable);
  const lines = [
    "You are running inside Zotero, a reference manager for research papers.",
    `Each task is a Zotero note tagged "${getTaskTag()}". A task's category is the name of the library its note is in.`,
    "Tasks you create are saved as new notes in My Library.",
    "A task with extra.parentTitle is about that paper (the note's parent item).",
  ];
  if (readOnly.length > 0) {
    lines.push(
      `These libraries are read-only, so their tasks cannot be changed: ${readOnly
        .map((library) => `"${library.name}"`)
        .join(", ")}.`,
    );
  }
  return lines.join("\n");
}
