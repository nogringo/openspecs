import { describe, expect, it } from "vitest";
import { mergeDocs } from "./corpus-store";
import type { SearchDoc } from "./search";

const doc = (identifier: string, revisedAt: number, title = identifier): SearchDoc => ({
  path: `/spec/npub1/${identifier}`,
  title,
  summary: "",
  pubkey: "a".repeat(64),
  npub: "npub1",
  identifier,
  status: null,
  kinds: [],
  topics: [],
  publishedAt: 1_700_000_000,
  revisedAt,
  content: "",
});

const titles = (docs: SearchDoc[]): string[] => docs.map((entry) => entry.title).sort();

describe("mergeDocs", () => {
  it("keeps the newest revision of a document", () => {
    const merged = mergeDocs([doc("a", 1, "old")], [doc("a", 2, "new")]);
    expect(titles(merged)).toEqual(["new"]);
  });

  it("keeps the stored revision when the relays served an older one", () => {
    const merged = mergeDocs([doc("a", 2, "new")], [doc("a", 1, "old")]);
    expect(titles(merged)).toEqual(["new"]);
  });

  it("tells two documents by the same author apart", () => {
    const merged = mergeDocs([doc("a", 1)], [doc("b", 1)]);
    expect(titles(merged)).toEqual(["a", "b"]);
  });

  it("tells two authors of the same identifier apart", () => {
    const mine = doc("shared", 1, "mine");
    const theirs = { ...doc("shared", 1, "theirs"), pubkey: "b".repeat(64) };
    expect(titles(mergeDocs([mine], [theirs]))).toEqual(["mine", "theirs"]);
  });

  it("reads an empty store as nothing to merge", () => {
    expect(mergeDocs([], [])).toEqual([]);
  });
});
