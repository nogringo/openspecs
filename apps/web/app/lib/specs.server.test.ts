import { afterEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({ fetchSpec: vi.fn(), fetchSpecs: vi.fn() }));
const held = vi.hoisted(() => ({ specs: [] as unknown[], read: true }));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

vi.mock("./corpus.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./corpus.server")>();
  type Held = import("@openspecs/nostr").Spec;
  return {
    ...actual,
    corpus: {
      start: () => Promise.resolve(),
      spec: (pubkey: string, identifier: string) =>
        (held.specs as Held[]).find(
          (spec) => spec.pubkey === pubkey && spec.identifier === identifier,
        ),
      specs: () => (held.read ? (held.specs as Held[]) : undefined),
    },
  };
});

import { parseSpec, SPEC_KIND, type Spec } from "@openspecs/nostr";
import { loadSpec, loadSpecs } from "./specs.server";

const ALICE = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const BOB = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

let ids = 0;

const specOf = (
  pubkey: string,
  identifier: string,
  createdAt: number,
  tags: string[][] = [],
  content = "A paragraph.",
): Spec => {
  ids += 1;
  const spec = parseSpec({
    id: ids.toString(16).padStart(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags: [["d", identifier], ...tags],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const never = () => new Promise<never>(() => {});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  nostr.fetchSpec.mockReset();
  nostr.fetchSpecs.mockReset();
  held.specs = [];
  held.read = true;
});

describe("loadSpecs", () => {
  it("answers from the corpus, newest first, without asking the relays", async () => {
    held.specs = [
      specOf(ALICE, "old", 1, [["t", "nostr"]]),
      specOf(BOB, "new", 3, [["t", "nostr"]]),
      specOf(BOB, "other", 2, [["t", "git"]]),
      specOf(ALICE, "blank", 4, [["t", "nostr"]], ""),
    ];

    const cards = await loadSpecs({ topic: "nostr" }, 10);
    expect(cards.map((card) => card.identifier)).toEqual(["new", "old"]);
    expect(nostr.fetchSpecs).not.toHaveBeenCalled();
  });

  it("filters on the kind a document covers", async () => {
    held.specs = [specOf(ALICE, "dm", 1, [["k", "14"]]), specOf(ALICE, "note", 1, [["k", "1"]])];

    const cards = await loadSpecs({ kind: 14 }, 10);
    expect(cards.map((card) => card.identifier)).toEqual(["dm"]);
  });

  it("serves an author's shelf from the corpus and asks their relays behind it", async () => {
    held.specs = [specOf(ALICE, "mine", 1), specOf(BOB, "theirs", 1)];
    nostr.fetchSpecs.mockImplementation(never);

    const cards = await loadSpecs({ author: ALICE }, 10);
    expect(cards.map((card) => card.identifier)).toEqual(["mine"]);
    expect(nostr.fetchSpecs).toHaveBeenCalledTimes(1);
  });

  it("asks the relays while the corpus has not been read", async () => {
    held.read = false;
    nostr.fetchSpecs.mockResolvedValue([specOf(ALICE, "relayed", 1)]);

    const cards = await loadSpecs({ topic: "unread" }, 10);
    expect(cards.map((card) => card.identifier)).toEqual(["relayed"]);
  });
});

describe("loadSpec", () => {
  it("serves a document the corpus holds without waiting on the relays", async () => {
    held.specs = [specOf(ALICE, "held", 1)];
    nostr.fetchSpec.mockImplementation(never);

    const cached = await loadSpec(ALICE, "held");
    expect(cached?.page.identifier).toBe("held");
    expect(nostr.fetchSpec).toHaveBeenCalledTimes(1);
  });

  it("keeps a known document when the relays answer nothing", async () => {
    held.specs = [specOf(ALICE, "kept", 1)];
    nostr.fetchSpec.mockResolvedValue(null);

    await loadSpec(ALICE, "kept");
    await flush();
    await expect(loadSpec(ALICE, "kept")).resolves.not.toBeNull();
  });

  it("serves the newer revision of the two", async () => {
    held.specs = [specOf(ALICE, "revised", 1, [], "Held.")];
    nostr.fetchSpec.mockResolvedValue(specOf(ALICE, "revised", 2, [], "Fetched."));

    await loadSpec(ALICE, "revised");
    await flush();
    const cached = await loadSpec(ALICE, "revised");
    expect(cached?.event.content).toBe("Fetched.");
  });
});
