/**
 * Pure logic for turning to-do style annotations into task proposals.
 */
import { capText } from "./toolOutput";

export interface AnnotationInput {
  key: string;
  text?: string;
  comment?: string;
  pageLabel?: string;
}

export interface TaskProposal {
  annotationKey: string;
  title: string;
  description: string;
}

/** Markers that make an annotation a to-do when no custom match is given. */
const TODO_MARKER =
  /(?:^|\s)(?:TODO|TO-DO|FIXME)\b[:：]?|待办[:：]?|待读[:：]?|待查[:：]?|\[ \]/i;

function isTodo(annotation: AnnotationInput, match?: string): boolean {
  const haystack = `${annotation.comment ?? ""}\n${annotation.text ?? ""}`;
  return match
    ? haystack.toLowerCase().includes(match.toLowerCase())
    : TODO_MARKER.test(haystack);
}

function titleFor(annotation: AnnotationInput): string {
  const fromComment = (annotation.comment ?? "")
    .replace(new RegExp(TODO_MARKER.source, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const title =
    fromComment || (annotation.text ?? "").replace(/\s+/g, " ").trim();
  return capText(title, 120);
}

/** Description line; also how duplicates are recognized later. */
export function annotationQuote(annotation: AnnotationInput): string {
  const page = annotation.pageLabel ? ` on p. ${annotation.pageLabel}` : "";
  // Whitespace is normalized like note text, so duplicates can be found.
  const text = annotation.text?.replace(/\s+/g, " ").trim();
  const quote = text ? `: “${capText(text, 300)}”` : "";
  return `From an annotation${page}${quote}`;
}

/**
 * Proposals for to-do annotations, skipping ones already turned into tasks
 * (an existing task note under the same item contains the same quote).
 */
export function proposeTasksFromAnnotations(
  annotations: AnnotationInput[],
  existingTaskTexts: string[],
  match?: string,
): { proposals: TaskProposal[]; alreadyTasks: number } {
  const proposals: TaskProposal[] = [];
  let alreadyTasks = 0;
  for (const annotation of annotations) {
    if (!isTodo(annotation, match)) continue;
    const title = titleFor(annotation);
    if (!title) continue;
    const description = annotationQuote(annotation);
    if (existingTaskTexts.some((text) => text.includes(description))) {
      alreadyTasks++;
      continue;
    }
    proposals.push({ annotationKey: annotation.key, title, description });
  }
  return { proposals, alreadyTasks };
}
