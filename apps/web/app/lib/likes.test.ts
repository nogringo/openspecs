import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRelays: vi.fn() }));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  queryRelays: mocks.queryRelays,
}));

import {
  buildReaction,
  buildRetraction,
  CONVERSATION_RELAYS,
  LIKE,
  type NostrEvent,
  SPEC_KIND,
} from "@openspecs/nostr";
import type { Filter } from "nostr-tools/filter";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { clearLikes, likeKey, likesState, rememberLike, subscribeLikes, wantLikes } from "./likes";

const authorKey = generateSecretKey();
const aliceKey = generateSecretKey();
const bobKey = generateSecretKey();
const author = getPublicKey(authorKey);
const alice = getPublicKey(aliceKey);

const spec = (identifier: string) => ({ pubkey: author, identifier });
const A = likeKey(spec("a"));
const B = likeKey(spec("b"));

const reaction = (key: Uint8Array, coordinate: string, content = LIKE, at = 1_700_000_000) =>
  finalizeEvent(
    {
      ...buildReaction(
        { id: "d".repeat(64), pubkey: author, kind: SPEC_KIND, coordinate },
        content,
      ),
      created_at: at,
    },
    key,
  );

const retraction = (key: Uint8Array, id: string) =>
  finalizeEvent({ ...buildRetraction(id), created_at: 1_700_000_100 }, key);

/** Plays every relay at once: whatever matches the filter is what they hold. */
const holding = (events: NostrEvent[]) =>
  mocks.queryRelays.mockImplementation(async (_relays: string[], filter: Filter) =>
    events.filter(
      (event) =>
        (filter.kinds?.includes(event.kind) ?? true) &&
        Object.entries(filter)
          .filter(([name]) => name.startsWith("#"))
          .every(([name, values]) =>
            event.tags.some(
              (tag) => tag[0] === name.slice(1) && (values as string[]).includes(tag[1] ?? ""),
            ),
          ),
    ),
  );

const filters = () => mocks.queryRelays.mock.calls.map((call) => call[1] as Filter);

const settle = () => vi.advanceTimersByTimeAsync(200);

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
  clearLikes();
  mocks.queryRelays.mockReset();
  holding([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("wantLikes", () => {
  it("asks for the coordinates that appear together in one filter, on the conversation relays", async () => {
    wantLikes([A]);
    wantLikes([B]);
    await settle();

    expect(filters()).toEqual([{ kinds: [7], "#a": [A, B] }]);
    expect(mocks.queryRelays.mock.calls[0]?.[0]).toBe(CONVERSATION_RELAYS);
    expect(likesState()).toEqual({ [A]: 0, [B]: 0 });
  });

  it("asks about each coordinate once per session", async () => {
    wantLikes([A]);
    await settle();
    wantLikes([A, B]);
    await settle();

    expect(filters().map((filter) => filter["#a"])).toEqual([[A], [B]]);
  });

  it("counts the likes and nothing else, and one reader once", async () => {
    holding([
      reaction(aliceKey, A, LIKE, 10),
      reaction(aliceKey, A, LIKE, 20),
      reaction(bobKey, A, "🔥"),
      reaction(bobKey, B),
    ]);
    wantLikes([A, B]);
    await settle();

    expect(likesState()).toEqual({ [A]: 1, [B]: 1 });
  });

  it("drops a like its own author took back, and keeps one somebody else asked to drop", async () => {
    const mine = reaction(aliceKey, A);
    const theirs = reaction(bobKey, A);
    holding([mine, theirs, retraction(aliceKey, mine.id), retraction(aliceKey, theirs.id)]);
    wantLikes([A]);
    await settle();

    expect(filters()[1]).toEqual({ kinds: [5], "#e": [mine.id, theirs.id] });
    expect(likesState()[A]).toBe(1);
  });

  it("asks about retractions only when something was liked", async () => {
    wantLikes([A]);
    await settle();
    expect(filters()).toHaveLength(1);
  });

  it("ignores a like a relay returned for a document nobody asked about", async () => {
    holding([reaction(aliceKey, likeKey(spec("elsewhere")))]);
    // The fake relay honours the filter, so the stray one has to be pushed through it.
    mocks.queryRelays.mockResolvedValueOnce([reaction(aliceKey, likeKey(spec("elsewhere")))]);
    wantLikes([A]);
    await settle();

    expect(likesState()).toEqual({ [A]: 0 });
    expect(filters()).toHaveLength(1);
  });

  it("cuts a long page into filters a relay accepts", async () => {
    wantLikes(Array.from({ length: 201 }, (_, index) => likeKey(spec(`spec-${index}`))));
    await settle();

    expect(filters().map((filter) => filter["#a"]?.length)).toEqual([200, 1]);
  });

  it("leaves the counts alone when the relays do not answer", async () => {
    mocks.queryRelays.mockRejectedValue(new Error("gone"));
    const before = likesState();
    wantLikes([A]);
    await settle();

    expect(likesState()).toBe(before);
  });
});

describe("rememberLike", () => {
  it("moves a count this browser has, and tells whoever is watching", async () => {
    holding([reaction(bobKey, A)]);
    wantLikes([A]);
    await settle();
    const heard = vi.fn();
    subscribeLikes(heard);

    rememberLike(A, 1);
    expect(likesState()[A]).toBe(2);
    rememberLike(A, -1);
    rememberLike(A, -1);
    rememberLike(A, -1);
    expect(likesState()[A]).toBe(0);
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it("leaves a coordinate nobody asked about to the asking", () => {
    rememberLike(A, 1);
    expect(likesState()).toEqual({});
    expect(alice).not.toBe(author);
  });
});
