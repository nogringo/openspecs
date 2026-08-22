import { SPEC_KIND, type Spec } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { isNewerRevision, toPage } from "./spec-page";

const PUBKEY = "a".repeat(64);

const revision = (
  createdAt: number,
  id: string,
  content = "# A document\n\nA paragraph.\n\n## A section\n\nAnother.",
): Spec => ({
  event: {
    id,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags: [["d", "a-document"]],
    content,
    sig: "f".repeat(128),
  },
  pubkey: PUBKEY,
  identifier: "a-document",
  title: "A document",
  titleIsDerived: false,
  summary: "A paragraph.",
  summaryIsDerived: true,
  content,
  kinds: [],
  topics: [],
  status: null,
  createdAt,
  publishedAt: createdAt,
  forks: [],
  isEmpty: content.trim() === "",
});

const shown = toPage(revision(1_700_000_000, "b".repeat(64)));

describe("toPage", () => {
  it("renders the document rather than shipping it twice", () => {
    const page = toPage(revision(1_700_000_000, "c".repeat(64)));
    expect(page.html).toContain("<p>A paragraph.</p>");
    // The opening heading repeats the title and the renderer drops it, so what
    // the contents rail is built from is what is left below it.
    expect(page.headings.map((heading) => heading.text)).toEqual(["A section"]);
  });

  /**
   * `isNewerRevision` reads the moment a revision was signed off this field, so
   * the day it stops meaning `createdAt` the comparison silently stops working.
   */
  it("dates the page by when its revision was signed", () => {
    expect(toPage(revision(1_700_000_500, "c".repeat(64))).revisedAt).toBe(1_700_000_500);
  });

  it("carries the links a document cites, so their previews can be matched to it", () => {
    const page = toPage(revision(1_700_000_000, "c".repeat(64), "See <https://example.com/spec>."));
    expect(page.links).toContain("https://example.com/spec");
  });
});

describe("isNewerRevision", () => {
  it("takes a revision signed after the one on screen", () => {
    expect(isNewerRevision(revision(1_700_000_100, "d".repeat(64)), shown)).toBe(true);
  });

  /** A relay serving a superseded revision is answering honestly, and is ignored. */
  it("refuses one signed before it, however recently a relay served it", () => {
    expect(isNewerRevision(revision(1_699_999_900, "d".repeat(64)), shown)).toBe(false);
  });

  it("has nothing to offer for the revision already on screen", () => {
    expect(isNewerRevision(revision(1_700_000_000, "b".repeat(64)), shown)).toBe(false);
  });

  /** The same tie NIP-01 and `latestByCoordinate` break, broken the same way. */
  it("breaks a tie on the lowest id, so this and the loader agree", () => {
    expect(isNewerRevision(revision(1_700_000_000, "a".repeat(64)), shown)).toBe(true);
    expect(isNewerRevision(revision(1_700_000_000, "f".repeat(64)), shown)).toBe(false);
  });

  it("never swaps in another author's document", () => {
    const theirs = { ...revision(1_700_000_100, "d".repeat(64)), pubkey: "e".repeat(64) };
    expect(isNewerRevision(theirs, shown)).toBe(false);
  });

  it("never swaps in another document of the same author", () => {
    const other = { ...revision(1_700_000_100, "d".repeat(64)), identifier: "another" };
    expect(isNewerRevision(other, shown)).toBe(false);
  });
});
