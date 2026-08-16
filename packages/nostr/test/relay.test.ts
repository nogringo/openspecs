import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SPEC_KIND } from "../src/event";
import { clearRelayListCache, RELAY_LIST_KIND } from "../src/nip65";
import { type FetchOptions, fetchSpec, fetchSpecs, latestByCoordinate } from "../src/relay";
import { parseSpec, type Spec } from "../src/spec";
import { caseEvents, events } from "./fixtures";

const parse = (list: typeof events): Spec[] => list.map(parseSpec).filter((spec) => spec !== null);

describe("latestByCoordinate", () => {
  it("keeps one revision per coordinate, the newest", () => {
    const revisions = parse(caseEvents("same-coordinate-two-revisions"));
    const live = latestByCoordinate(revisions);

    expect(live.length).toBeLessThan(revisions.length);
    for (const spec of live) {
      const sameCoordinate = revisions.filter(
        (other) => other.pubkey === spec.pubkey && other.identifier === spec.identifier,
      );
      expect(spec.createdAt).toBe(Math.max(...sameCoordinate.map((other) => other.createdAt)));
    }
  });

  it("leaves distinct coordinates alone", () => {
    const all = parse(events);
    const coordinates = new Set(all.map((spec) => `${spec.pubkey}:${spec.identifier}`));
    expect(latestByCoordinate(all)).toHaveLength(coordinates.size);
  });

  it("breaks a tie on the lowest id, as relays do", () => {
    const spec = parse(events)[0];
    if (!spec) throw new Error("no fixture specification");
    const withId = (id: string): Spec => ({ ...spec, event: { ...spec.event, id } });
    const low = withId("a".repeat(64));
    const high = withId("f".repeat(64));

    expect(latestByCoordinate([high, low])[0]?.event.id).toBe(low.event.id);
    expect(latestByCoordinate([low, high])[0]?.event.id).toBe(low.event.id);
  });
});

/**
 * These read through mock relays rather than a stubbed pool, so the pool, the
 * subscriptions and the relay URLs are exercised too. The events are signed
 * here because the scenario needs an author whose relay list points at a relay
 * that only exists during the test.
 */
const secretKey = generateSecretKey();
const author = getPublicKey(secretKey);
const identifier = "the-document";
const pointer = { pubkey: author, identifier };

const revision = (createdAt: number, title: string) =>
  finalizeEvent(
    {
      kind: SPEC_KIND,
      created_at: createdAt,
      tags: [
        ["d", identifier],
        ["title", title],
      ],
      content: `# ${title}\n\nA specification, in one paragraph.`,
    },
    secretKey,
  );

const stale = revision(1_700_000_000, "The revision the aggregators kept");
const live = revision(1_700_000_100, "The revision the author published last");

const startRelay = async (): Promise<MockRelay> => {
  const relay = createMockRelay();
  await relay.start();
  return relay;
};

const relayListOn = (relay: MockRelay) =>
  finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: 1_700_000_200,
      tags: [["r", relay.url ?? "", "write"]],
      content: "",
    },
    secretKey,
  );

let aggregator: MockRelay;
let authorRelay: MockRelay;
let indexer: MockRelay;
let options: FetchOptions;

beforeAll(async () => {
  [aggregator, authorRelay, indexer] = await Promise.all([
    startRelay(),
    startRelay(),
    startRelay(),
  ]);

  aggregator.seed([stale]);
  authorRelay.seed([live]);
  indexer.seed([relayListOn(authorRelay)]);

  options = { relays: [aggregator.url ?? ""], indexers: [indexer.url ?? ""] };
});

afterAll(async () => {
  await Promise.all([aggregator.stop(), authorRelay.stop(), indexer.stop()]);
});

beforeEach(clearRelayListCache);

describe("fetchSpec", () => {
  it("returns the revision held by the author's write relays", async () => {
    expect((await fetchSpec(pointer, options))?.event.id).toBe(live.id);
  });

  it("is left with the stale revision once the relay list is ignored", async () => {
    const spec = await fetchSpec(pointer, { ...options, outbox: false });
    expect(spec?.event.id).toBe(stale.id);
  });

  it("still answers when the author published no relay list", async () => {
    const empty = await startRelay();
    try {
      const spec = await fetchSpec(pointer, { ...options, indexers: [empty.url ?? ""] });
      expect(spec?.event.id).toBe(stale.id);
    } finally {
      await empty.stop();
    }
  });

  it("keeps a relay list it already resolved, even once the indexer is gone", async () => {
    const shortLived = await startRelay();
    shortLived.seed([relayListOn(authorRelay)]);
    const withOwnIndexer = { ...options, indexers: [shortLived.url ?? ""] };

    expect((await fetchSpec(pointer, withOwnIndexer))?.event.id).toBe(live.id);
    await shortLived.stop();
    expect((await fetchSpec(pointer, withOwnIndexer))?.event.id).toBe(live.id);
  });

  it("returns null for a document no relay holds", async () => {
    expect(await fetchSpec({ pubkey: author, identifier: "never-published" }, options)).toBeNull();
  });
});

describe("fetchSpecs", () => {
  it("merges what several relays hold, keeping the live revision", async () => {
    const specs = await fetchSpecs({ authors: [author] }, options);
    expect(specs.map((spec) => spec.event.id)).toEqual([live.id]);
  });

  it("returns nothing for an author who published nothing", async () => {
    const stranger = getPublicKey(generateSecretKey());
    expect(await fetchSpecs({ authors: [stranger] }, options)).toEqual([]);
  });
});
