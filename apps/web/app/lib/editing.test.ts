import { describe, expect, it } from "vitest";
import { type Edit, indentEdit, locate, place } from "./editing";

/** The value once an edit is made, with the selection drawn as brackets. */
const apply = (value: string, edit: Edit | null): string => {
  if (edit === null) return value;
  const next = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  const [start, end] = edit.select;
  return `${next.slice(0, start)}[${next.slice(start, end)}]${next.slice(end)}`;
};

describe("indentEdit", () => {
  it("puts two spaces where the caret stands", () => {
    expect(apply('{\n"kind": 1', indentEdit('{\n"kind": 1', 2, 2, false))).toBe('{\n  []"kind": 1');
  });

  it("replaces a selection inside one line", () => {
    expect(apply("a bc d", indentEdit("a bc d", 2, 4, false))).toBe("a   [] d");
  });

  it("indents every line a selection crosses, and leaves blank ones alone", () => {
    const value = "one\n\ntwo\nthree";
    expect(apply(value, indentEdit(value, 1, 7, false))).toBe("[  one\n\n  two]\nthree");
  });

  it("does not reach into the line a selection ends at the start of", () => {
    const value = "one\ntwo\nthree";
    expect(apply(value, indentEdit(value, 0, 8, false))).toBe("[  one\n  two]\nthree");
  });

  it("takes up to two spaces off every line a selection crosses", () => {
    const value = "    one\n two\nthree";
    expect(apply(value, indentEdit(value, 0, 12, true))).toBe("[  one\ntwo]\nthree");
  });

  it("outdents the caret's line and keeps the caret on its word", () => {
    const value = "a\n    b";
    expect(apply(value, indentEdit(value, 6, 6, true))).toBe("a\n  []b");
  });

  it("changes nothing when there is nothing to outdent", () => {
    expect(indentEdit("flush", 2, 2, true)).toBeNull();
  });
});

describe("locate and place", () => {
  const edges = [100, 300, 400, 1000];

  it("finds the section a point is in and how far through it", () => {
    expect(locate(edges, 350)).toEqual({ section: 1, through: 0.5 });
  });

  it("knows nothing of a point outside the document", () => {
    expect(locate(edges, 50)).toBeNull();
    expect(locate(edges, 1000)).toBeNull();
  });

  it("lands the same distance through the same section of another drawing", () => {
    expect(place([0, 200, 600, 900], { section: 1, through: 0.5 })).toBe(400);
  });

  it("has nowhere to land when the other drawing has fewer sections", () => {
    expect(place([0, 900], { section: 1, through: 0.5 })).toBeNull();
  });
});
