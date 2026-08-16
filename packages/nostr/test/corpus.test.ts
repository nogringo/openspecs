import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Cursors, syncSpecs } from "../src/corpus";
import { SPEC_KIND } from "../src/event";
import { relaySet } from "../src/pool";
import type { Spec } from "../src/spec";

const secretKey = generateSecretKey();

/**
 * Distinct coordinates rather than revisions: a relay keeps one event per
 * addressable coordinate, so thirty five revisions of one document would leave
 * a single event to page through.
 */
const document = (index: number, createdAt: number) =>
  finalizeEvent(
    {
      kind: SPEC_KIND,
      created_at: createdAt,
      tags: [
        ["d", `document-${index}`],
        ["title", `Document ${index}`],
      ],
      content: `# Document ${index}\n\nA specification, in one paragraph.`,
    },
    secretKey,
  );

const startRelay = async (seed: ReturnType<typeof document>[]): Promise<MockRelay> => {
  const relay = createMockRelay();
  await relay.start();
  relay.seed(seed);
  return relay;
};

/** The cursor is keyed by the URL the pool connects to, not by the one asked for. */
const key = (relay: MockRelay): string => relaySet([relay.url ?? ""])[0] ?? "";

const found = (specs: Spec[]): string[] => specs.map((spec) => spec.identifier).sort();

const seeded = (events: ReturnType<typeof document>[]): string[] =>
  events.map((event) => event.tags.find((tag) => tag[0] === "d")?.[1] ?? "").sort();

const NEWEST = 1_700_000_000 + 34 * 60;

/** Thirty five documents, one per minute, so every page boundary falls between timestamps. */
const deep = Array.from({ length: 35 }, (_, index) => document(index, 1_700_000_000 + index * 60));

/** Two relays covering the same span, one of them far denser near the top of it. */
const spread = [document(100, 1_700_000_000), document(101, 1_700_050_000)];
const dense = Array.from({ length: 12 }, (_, index) =>
  document(200 + index, 1_700_040_000 + index * 60),
);

let deepRelay: MockRelay;
let spreadRelay: MockRelay;
let denseRelay: MockRelay;

beforeAll(async () => {
  [deepRelay, spreadRelay, denseRelay] = await Promise.all([
    startRelay(deep),
    startRelay(spread),
    startRelay(dense),
  ]);
});

afterAll(async () => {
  await Promise.all([deepRelay.stop(), spreadRelay.stop(), denseRelay.stop()]);
});

describe("syncSpecs", () => {
  it("pages past a relay's limit rather than stopping at the first answer", async () => {
    const { specs } = await syncSpecs({ relays: [deepRelay.url ?? ""], pageSize: 10 });
    expect(found(specs)).toEqual(seeded(deep));
  });

  it("reads a relay whole even when another one runs deeper", async () => {
    const { specs } = await syncSpecs({
      relays: [spreadRelay.url ?? "", denseRelay.url ?? ""],
      pageSize: 5,
    });

    // One shared cursor would walk down to the spread relay's floor and lose
    // everything the dense relay held above it.
    expect(found(specs)).toEqual(seeded([...spread, ...dense]));
  });

  it("reports where each relay stopped", async () => {
    const { cursors } = await syncSpecs({ relays: [deepRelay.url ?? ""], pageSize: 10 });
    expect(cursors[key(deepRelay)]).toEqual({ newestAt: NEWEST, exhausted: true });
  });

  it("says a relay is not exhausted once a guard rail stopped the walk", async () => {
    const { specs, cursors } = await syncSpecs({
      relays: [deepRelay.url ?? ""],
      pageSize: 10,
      maxPages: 2,
    });

    // Ten, then nine: the second page repeats the timestamp the first ended on.
    expect(specs).toHaveLength(19);
    expect(cursors[key(deepRelay)]?.exhausted).toBe(false);
  });

  it("asks an exhausted relay only for what it has learned since", async () => {
    const cursors: Cursors = {
      [key(deepRelay)]: { newestAt: 1_700_000_000 + 33 * 60, exhausted: true },
    };
    const { specs } = await syncSpecs({ relays: [deepRelay.url ?? ""], cursors });

    // `since` is inclusive, so the document sitting on the cursor comes back too.
    expect(found(specs)).toEqual(["document-33", "document-34"]);
  });

  it("walks a relay again from the top while it is not exhausted", async () => {
    const cursors: Cursors = {
      [key(deepRelay)]: { newestAt: 1_700_000_000 + 33 * 60, exhausted: false },
    };
    const { specs } = await syncSpecs({ relays: [deepRelay.url ?? ""], cursors });

    expect(found(specs)).toEqual(seeded(deep));
  });

  it("hands over each page as it lands", async () => {
    const pages: number[] = [];
    const { specs } = await syncSpecs({
      relays: [deepRelay.url ?? ""],
      pageSize: 10,
      onPage: (page) => pages.push(page.length),
    });

    // Each page after the first repeats the event its predecessor ended on,
    // which is the price of an inclusive `until` and is absorbed on merge.
    expect(pages).toEqual([10, 9, 9, 7]);
    expect(found(specs)).toEqual(seeded(deep));
  });

  it("keeps what the reachable relays hold when one of them is down", async () => {
    const gone = await startRelay(spread);
    const goneUrl = gone.url ?? "";
    const goneKey = key(gone);
    await gone.stop();

    const { specs, cursors } = await syncSpecs({
      relays: [deepRelay.url ?? "", goneUrl],
      pageSize: 10,
      timeoutMs: 500,
    });

    expect(found(specs)).toEqual(seeded(deep));
    // No watermark, so the relay is read from the top once it answers again.
    expect(cursors[goneKey]?.newestAt).toBe(0);
  });

  it("keeps a watermark a relay had already earned when it answers nothing", async () => {
    const gone = await startRelay(spread);
    const goneUrl = gone.url ?? "";
    const goneKey = key(gone);
    await gone.stop();

    const { cursors } = await syncSpecs({
      relays: [goneUrl],
      cursors: { [goneKey]: { newestAt: NEWEST, exhausted: true } },
      timeoutMs: 500,
    });

    expect(cursors[goneKey]?.newestAt).toBe(NEWEST);
  });
});
