import {
  parseSpec,
  SPEC_KIND,
  type Spec,
  type SyncOptions,
  type SyncResult,
} from "@openspecs/nostr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpus, hasTag } from "./corpus.server";

const ALICE = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const BOB = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

let ids = 0;

const specOf = (pubkey: string, identifier: string, createdAt: number, content = "Body."): Spec => {
  ids += 1;
  const spec = parseSpec({
    id: ids.toString(16).padStart(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags: [
      ["d", identifier],
      ["t", "nostr"],
    ],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const resultOf = (specs: Spec[]): SyncResult => ({
  specs,
  cursors: { "wss://relay.example": { newestAt: 1, exhausted: true } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCorpus", () => {
  it("holds a document as soon as a page brings it, and the whole listing only at the end", async () => {
    let release: () => void = () => {};
    const sync = vi.fn(
      (options: SyncOptions) =>
        new Promise<SyncResult>((resolve) => {
          options.onPage?.([specOf(ALICE, "nip-01", 1)]);
          release = () => resolve(resultOf([specOf(ALICE, "nip-01", 1)]));
        }),
    );
    const corpus = createCorpus({ sync, warm: () => {} });

    const walked = corpus.start();
    expect(corpus.spec(ALICE, "nip-01")?.identifier).toBe("nip-01");
    expect(corpus.specs()).toBeUndefined();

    release();
    await walked;
    expect(corpus.specs()?.map((spec) => spec.identifier)).toEqual(["nip-01"]);
  });

  it("keeps the newest revision of a document, a blank one included", async () => {
    const sync = vi.fn(async () =>
      resultOf([specOf(ALICE, "nip-01", 2, ""), specOf(ALICE, "nip-01", 1)]),
    );
    const corpus = createCorpus({ sync, warm: () => {} });

    await corpus.start();
    expect(corpus.spec(ALICE, "nip-01")?.isEmpty).toBe(true);
  });

  it("keeps what a later walk no longer brings", async () => {
    vi.useFakeTimers();
    const sync = vi
      .fn<(options: SyncOptions) => Promise<SyncResult>>()
      .mockResolvedValueOnce(resultOf([specOf(ALICE, "nip-01", 1)]))
      .mockResolvedValue(resultOf([specOf(BOB, "nip-02", 2)]));
    const corpus = createCorpus({ sync, warm: () => {}, refreshMs: 1000 });

    await corpus.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      corpus
        .specs()
        ?.map((spec) => spec.identifier)
        .sort(),
    ).toEqual(["nip-01", "nip-02"]);
  });

  it("asks only what changed, and never walks twice at once", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const sync = vi
      .fn<(options: SyncOptions) => Promise<SyncResult>>()
      .mockResolvedValueOnce(resultOf([specOf(ALICE, "nip-01", 1)]))
      .mockImplementation(
        () =>
          new Promise<SyncResult>((resolve) => {
            release = () => resolve(resultOf([]));
          }),
      );
    const corpus = createCorpus({ sync, warm: () => {}, refreshMs: 1000 });

    await corpus.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync.mock.calls[1]?.[0].cursors).toEqual({
      "wss://relay.example": { newestAt: 1, exhausted: true },
    });

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("warms every author it holds after each walk", async () => {
    const warm = vi.fn();
    const sync = vi.fn(async () =>
      resultOf([specOf(ALICE, "nip-01", 1), specOf(ALICE, "nip-02", 1), specOf(BOB, "x", 1)]),
    );
    const corpus = createCorpus({ sync, warm });

    await corpus.start();
    expect(warm).toHaveBeenCalledWith([ALICE, BOB]);
  });

  it("starts once, however often it is asked to", async () => {
    const sync = vi.fn(async () => resultOf([]));
    const corpus = createCorpus({ sync, warm: () => {} });

    await Promise.all([corpus.start(), corpus.start()]);
    await corpus.start();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe("hasTag", () => {
  it("matches a tag value exactly, as a relay does", () => {
    const spec = specOf(ALICE, "nip-01", 1);
    expect(hasTag(spec, "t", "nostr")).toBe(true);
    expect(hasTag(spec, "t", "Nostr")).toBe(false);
    expect(hasTag(spec, "d", "nip-01")).toBe(true);
  });
});
