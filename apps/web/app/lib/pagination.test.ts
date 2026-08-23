import { describe, expect, it } from "vitest";
import { pageOf } from "./pagination";

const items = Array.from({ length: 94 }, (_, index) => index);

describe("pageOf", () => {
  it("cuts a listing into pages of the size asked for", () => {
    expect(pageOf(items, 1, 20).items).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(pageOf(items, 2, 20).items[0]).toBe(20);
    expect(pageOf(items, 5, 20)).toMatchObject({ page: 5, pages: 5, total: 94 });
  });

  it("leaves the last page short rather than padding it", () => {
    expect(pageOf(items, 5, 20).items).toHaveLength(14);
  });

  it("counts an exact multiple without an empty page after it", () => {
    expect(pageOf(items.slice(0, 60), 1, 20).pages).toBe(3);
  });

  it("is page one of one when there is nothing to show", () => {
    expect(pageOf([], 1, 20)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });

  it("clamps a page past the end to the last one", () => {
    expect(pageOf(items, 99, 20)).toMatchObject({ page: 5 });
    expect(pageOf([], 4, 20)).toMatchObject({ page: 1 });
  });

  it("clamps a page below the first one", () => {
    for (const page of [0, -3, 0.5]) {
      expect(pageOf(items, page, 20).page, String(page)).toBe(1);
    }
  });
});
