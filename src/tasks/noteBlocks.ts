/**
 * Splits Zotero note HTML into the plain text of its top-level blocks.
 * The note editor wraps saved notes in <div data-schema-version="N">; notes
 * created through the API may not be wrapped.
 */
export function noteHtmlToBlocks(html: string, parser: DOMParser): string[] {
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) {
    throw new Error("Note HTML could not be parsed");
  }
  const wrapper =
    body.children.length === 1 &&
    body.firstElementChild?.hasAttribute("data-schema-version")
      ? body.firstElementChild
      : body;
  return Array.from(wrapper.childNodes)
    .map((node) => (node?.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}
