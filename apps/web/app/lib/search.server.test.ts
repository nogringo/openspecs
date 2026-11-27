import { afterEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ specs: [] as unknown[], read: true }));

vi.mock("./corpus.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./corpus.server")>()),
  corpus: {
    start: () => Promise.resolve(),
    spec: () => undefined,
    specs: () => (held.read ? held.specs : undefined),
  },
}));

import { parseSpec, SPEC_KIND, type Spec } from "@openspecs/nostr";
import { searchSpecs } from "./search.server";

const ALICE = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

let ids = 0;

const specOf = (identifier: string, tags: string[][], content: string): Spec => {
  ids += 1;
  const spec = parseSpec({
    id: ids.toString(16).padStart(64, "0"),
    pubkey: ALICE,
    created_at: ids,
    kind: SPEC_KIND,
    tags: [["d", identifier], ...tags],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const asked = { page: 1, pageSize: 20, topicsShown: 5 };

afterEach(() => {
  held.specs = [];
  held.read = true;
});

describe("searchSpecs", () => {
  it("answers from the corpus, without the bodies", async () => {
    held.specs = [
      specOf("dm", [["t", "chat"]], "A direct message is sealed."),
      specOf("other", [], "Nothing to see."),
      specOf("blank", [], ""),
    ];

    const found = await searchSpecs({ ...asked, query: "direct message" });
    expect(found.rows.map((row) => row.identifier)).toEqual(["dm"]);
    expect(found.rows[0]?.excerpt).toBe("A direct message is sealed.");
    expect(found.rows[0]).not.toHaveProperty("content");
    expect(found.documents).toBe(2);
  });

  it("offers the topics of what it found", async () => {
    held.specs = [specOf("a", [["t", "chat"]], "relay"), specOf("b", [["t", "media"]], "Nothing.")];

    const found = await searchSpecs({ ...asked, query: "relay" });
    expect(found.topics).toEqual(["chat"]);
  });

  it("narrows on the topic and the kind before searching", async () => {
    held.specs = [
      specOf(
        "a",
        [
          ["t", "chat"],
          ["k", "14"],
        ],
        "relay",
      ),
      specOf("b", [["t", "chat"]], "relay"),
      specOf("c", [["k", "14"]], "relay"),
    ];

    const found = await searchSpecs({ ...asked, query: "relay", topic: "chat", kind: 14 });
    expect(found.rows.map((row) => row.identifier)).toEqual(["a"]);
  });

  it("pages the results", async () => {
    held.specs = Array.from({ length: 5 }, (_, index) => specOf(`d${index}`, [], "relay"));

    const found = await searchSpecs({ ...asked, query: "relay", page: 2, pageSize: 2 });
    expect(found.rows).toHaveLength(2);
    expect(found).toMatchObject({ results: 5, page: 2, pages: 3 });
  });

  it("says so while the corpus has not been read", async () => {
    held.read = false;

    const found = await searchSpecs({ ...asked, query: "relay" });
    expect(found).toMatchObject({ reading: true, rows: [] });
  });
});
