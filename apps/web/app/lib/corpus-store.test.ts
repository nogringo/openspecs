import { describe, expect, it } from "vitest";
import { mergeDocs, written } from "./corpus-store";
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
  content: `# ${title}`,
});

/** What an author replaced a document with to withdraw it: an address and no text. */
const blank = (identifier: string, revisedAt: number): SearchDoc => ({
  ...doc(identifier, revisedAt, identifier),
  title: identifier,
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

describe("mergeDocs and a withdrawal", () => {
  it("lets a blank revision supersede the document it replaced", () => {
    expect(written(mergeDocs([doc("a", 1)], [blank("a", 2)]))).toEqual([]);
  });

  it("holds the blank revision, so it is there to outrank an older copy later", () => {
    const merged = mergeDocs([doc("a", 1)], [blank("a", 2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("");
  });

  /* Pages arrive from several relays in no order. One serving the revision a
     withdrawal replaced must not undo the withdrawal by answering last. */
  it("keeps a document withdrawn when an older copy arrives afterwards", () => {
    const withdrawn = mergeDocs([doc("a", 1)], [blank("a", 2)]);
    expect(written(mergeDocs(withdrawn, [doc("a", 1)]))).toEqual([]);
  });

  it("lets an author publish again at an address they withdrew", () => {
    const withdrawn = mergeDocs([doc("a", 1)], [blank("a", 2)]);
    expect(titles(written(mergeDocs(withdrawn, [doc("a", 3, "again")])))).toEqual(["again"]);
  });

  it("withdraws one document without touching another author's at the same address", () => {
    const theirs = { ...doc("shared", 1, "theirs"), pubkey: "b".repeat(64) };
    const merged = mergeDocs([doc("shared", 1, "mine"), theirs], [blank("shared", 2)]);
    expect(titles(written(merged))).toEqual(["theirs"]);
  });
});

describe("written", () => {
  it("keeps the documents there is something to read", () => {
    expect(titles(written([doc("a", 1), blank("b", 1), doc("c", 1)]))).toEqual(["a", "c"]);
  });

  it("counts a document of nothing but whitespace as blank", () => {
    expect(written([{ ...doc("a", 1), content: "  \n\t " }])).toEqual([]);
  });
});
