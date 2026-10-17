/**
 * Edits task note HTML in place. Only the title block, the metadata block and
 * (when it changed) the description are touched; everything else in the note
 * keeps its markup.
 */
import { isMetadataBlock } from "./noteFormat";
import type { TaskBlocks } from "./noteFormat";

export interface TaskNoteContent {
  title: string;
  metadataLine: string;
  /** New description; undefined keeps the existing description untouched. */
  description?: string;
}

export interface TaskNoteEdit {
  /**
   * The new title and metadata blocks, from the note's current text of
   * block 0 and (when there is one) of the metadata block.
   */
  blocks: (current: { title: string; metadata?: string }) => TaskBlocks;
  /** New description; undefined keeps the existing description untouched. */
  description?: string;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function textOf(node: Node): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function block(doc: Document, tag: string, text: string): HTMLElement {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  el.textContent = text;
  return el;
}

function parseBody(html: string, parser: DOMParser) {
  const doc = parser.parseFromString(html, "text/html");
  if (!doc.body) {
    throw new Error("Note HTML could not be parsed");
  }
  return { doc, body: doc.body };
}

function htmlOf(body: HTMLElement): string {
  return body.innerHTML as string;
}

function appendDescription(doc: Document, parent: Node, description: string) {
  for (const line of description.split("\n")) {
    if (line.trim()) parent.appendChild(block(doc, "p", line));
  }
}

/** HTML for a brand new task note. */
export function newTaskNoteHtml(
  content: TaskNoteContent,
  parser: DOMParser,
): string {
  const { doc, body } = parseBody("", parser);
  body.appendChild(block(doc, "h1", content.title));
  body.appendChild(block(doc, "p", content.metadataLine));
  if (content.description) appendDescription(doc, body, content.description);
  return htmlOf(body);
}

/**
 * Rewrites title and metadata (and description if given) in existing HTML.
 * A block whose text doesn't change keeps its markup.
 */
export function applyTaskNoteContent(
  html: string,
  edit: TaskNoteEdit,
  parser: DOMParser,
): string {
  const { doc, body } = parseBody(html, parser);
  const wrapper = body.firstElementChild;
  const container: Element =
    body.children.length === 1 && wrapper?.hasAttribute("data-schema-version")
      ? wrapper
      : body;
  const blocks: Node[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node && textOf(node).length > 0) blocks.push(node);
  }

  const existingMetadata = blocks[1];
  const hasMetadata =
    existingMetadata !== undefined &&
    existingMetadata.nodeType === existingMetadata.ELEMENT_NODE &&
    isMetadataBlock(textOf(existingMetadata));
  const content = edit.blocks({
    title: blocks[0] ? textOf(blocks[0]) : "",
    metadata: hasMetadata ? textOf(existingMetadata) : undefined,
  });

  let titleNode = blocks[0];
  if (!titleNode) {
    titleNode = container.appendChild(block(doc, "h1", content.title));
  } else if (titleNode.nodeType === titleNode.ELEMENT_NODE) {
    if (textOf(titleNode) !== content.title) {
      titleNode.textContent = content.title;
    }
  } else {
    const replacement = block(doc, "p", content.title);
    container.replaceChild(replacement, titleNode);
    titleNode = replacement;
  }

  let metadataNode = existingMetadata;
  if (hasMetadata) {
    if (textOf(metadataNode) !== content.metadataLine) {
      metadataNode.textContent = content.metadataLine;
    }
  } else {
    metadataNode = block(doc, "p", content.metadataLine);
    container.insertBefore(metadataNode, titleNode.nextSibling);
  }

  if (edit.description !== undefined) {
    let next = metadataNode.nextSibling;
    while (next) {
      const following = next.nextSibling;
      container.removeChild(next);
      next = following;
    }
    appendDescription(doc, container, edit.description);
  }
  return htmlOf(body);
}
