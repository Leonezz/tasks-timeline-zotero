/**
 * Pure helpers that keep tool output small and predictable. Everything a tool
 * returns ends up in the model's context, so text is capped and long text is
 * served in chunks.
 */

export interface TextChunk {
  text: string;
  offset: number;
  /** Offset of the next chunk, or null when this chunk reaches the end. */
  nextOffset: number | null;
  totalChars: number;
}

export function chunkText(
  text: string,
  offset: number,
  maxChars: number,
): TextChunk {
  const start = Math.min(Math.max(0, offset), text.length);
  const end = Math.min(text.length, start + maxChars);
  return {
    text: text.slice(start, end),
    offset: start,
    nextOffset: end < text.length ? end : null,
    totalChars: text.length,
  };
}

/** Caps a string, marking truncation so the model knows text is missing. */
export function capText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** Reads an optional integer argument, clamped to [min, max]. */
export function intArg(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected a number, got ${JSON.stringify(value)}`);
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Reads an optional string argument; blank strings count as absent. */
export function stringArg(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`"${name}" must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function requiredStringArg(value: unknown, name: string): string {
  const result = stringArg(value, name);
  if (!result) throw new Error(`"${name}" is required`);
  return result;
}
