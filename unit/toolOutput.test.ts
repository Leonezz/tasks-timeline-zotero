import { describe, expect, it } from "vitest";
import {
  capText,
  chunkText,
  intArg,
  requiredStringArg,
  stringArg,
} from "../src/ai/toolOutput";

describe("chunkText", () => {
  it("returns successive chunks with the next offset", () => {
    expect(chunkText("abcdefghij", 0, 4)).toEqual({
      text: "abcd",
      offset: 0,
      nextOffset: 4,
      totalChars: 10,
    });
    expect(chunkText("abcdefghij", 8, 4)).toEqual({
      text: "ij",
      offset: 8,
      nextOffset: null,
      totalChars: 10,
    });
  });

  it("clamps offsets outside the text", () => {
    expect(chunkText("abc", -5, 2).offset).toBe(0);
    expect(chunkText("abc", 99, 2)).toMatchObject({
      text: "",
      nextOffset: null,
    });
  });
});

describe("capText", () => {
  it("marks truncated text", () => {
    expect(capText("abcdef", 3)).toBe("abc…");
    expect(capText("abc", 3)).toBe("abc");
  });
});

describe("intArg", () => {
  const bounds = { min: 1, max: 25, fallback: 10 };

  it("uses the fallback when absent", () => {
    expect(intArg(undefined, bounds)).toBe(10);
    expect(intArg("", bounds)).toBe(10);
  });

  it("clamps and truncates", () => {
    expect(intArg(100, bounds)).toBe(25);
    expect(intArg(0, bounds)).toBe(1);
    expect(intArg("7.9", bounds)).toBe(7);
  });

  it("rejects non-numbers instead of guessing", () => {
    expect(() => intArg("many", bounds)).toThrow(/Expected a number/);
  });
});

describe("string args", () => {
  it("treats blank strings as absent", () => {
    expect(stringArg("  ", "q")).toBeUndefined();
    expect(stringArg(" x ", "q")).toBe("x");
  });

  it("rejects wrong types and missing required values", () => {
    expect(() => stringArg(3, "q")).toThrow(/must be a string/);
    expect(() => requiredStringArg(undefined, "ref")).toThrow(
      /"ref" is required/,
    );
  });
});
