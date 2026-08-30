import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const box: { state: unknown } = { state: null };
  return { listeners, box, addToDiscussion: vi.fn() };
});

const mocks = vi.hoisted(() => ({
  signDraft: vi.fn(),
  writeRelays: vi.fn(),
  enqueue: vi.fn(),
  rememberLike: vi.fn(),
}));

vi.mock("./discussion", () => ({
  discussionState: () => record.box.state,
  subscribeDiscussionState: (listener: () => void) => {
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  },
  addToDiscussion: record.addToDiscussion,
}));
vi.mock("./publish", () => ({ signDraft: mocks.signDraft }));
vi.mock("./relays", () => ({ writeRelays: mocks.writeRelays }));
vi.mock("./outbox", () => ({ enqueue: mocks.enqueue }));
vi.mock("./likes", () => ({ rememberLike: mocks.rememberLike }));

import {
  DEFAULT_RELAYS,
  DELETION_KIND,
  DISCUSSION_RELAYS,
  LIKE,
  type NostrEvent,
  REACTION_KIND,
  type ReactionTally,
  relaySet,
  SPEC_KIND,
} from "@openspecs/nostr";
import {
  clearReactions,
  intentsState,
  reactionKey,
  setReaction,
  subscribeIntents,
  withIntent,
} from "./reactions";

const me = "1".repeat(64);
const bob = "2".repeat(64);
const author = "3".repeat(64);

const TARGET = {
  id: "d".repeat(64),
  pubkey: author,
  kind: SPEC_KIND,
  coordinate: `${SPEC_KIND}:${author}:a-specification`,
};
const KEY = reactionKey(TARGET, LIKE);
const RELAYS = ["wss://relay.example"];

const tally = (symbol: string, by: Record<string, string>): ReactionTally => ({
  symbol,
  emojiUrl: null,
  count: Object.keys(by).length,
  by,
});

/** Plays the discussion store: what the relays hold about the document. */
const hold = (status: "loading" | "ready", reactions: ReactionTally[]) => {
  record.box.state = {
    coordinate: TARGET.coordinate,
    status,
    document: { reactions, zapSats: 0 },
    byComment: {},
  };
  for (const listener of record.listeners) listener();
};

const reactions = (): ReactionTally[] =>
  (record.box.state as { document: { reactions: ReactionTally[] } }).document.reactions;

let signed = 0;
const sign = (draft: { kind: number; content: string; tags: string[][]; created_at: number }) =>
  ({ ...draft, id: String(++signed).padStart(64, "0"), pubkey: me, sig: "" }) as NostrEvent;

const kinds = () => mocks.signDraft.mock.calls.map((call) => call[0].kind);

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.clearAllMocks();
  clearReactions();
  record.listeners.clear();
  signed = 0;

  mocks.signDraft.mockImplementation(async (draft) => sign(draft));
  mocks.writeRelays.mockResolvedValue(RELAYS);
  // The relays echo what was signed: a like lands in the tally, a retraction takes it out.
  record.addToDiscussion.mockImplementation((event: NostrEvent) => {
    if (event.kind === REACTION_KIND) {
      hold("ready", [tally(event.content, { ...reactions()[0]?.by, [me]: event.id })]);
    } else {
      const by = { ...reactions()[0]?.by };
      delete by[me];
      hold("ready", Object.keys(by).length === 0 ? [] : [tally(LIKE, by)]);
    }
  });
  hold("ready", []);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("setReaction", () => {
  it("shows the click at once, before anybody has signed anything", () => {
    mocks.signDraft.mockReturnValue(new Promise(() => {}));
    setReaction(me, TARGET, LIKE, true);

    const shown = withIntent([], me, TARGET, intentsState());
    expect(shown[0]?.count).toBe(1);
    expect(shown[0]?.by[me]).toBe("");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("signs a like, adds it to the record and hands it to the outbox", async () => {
    setReaction(me, TARGET, LIKE, true);
    await flush();

    const draft = mocks.signDraft.mock.calls[0]?.[0];
    expect(draft.kind).toBe(REACTION_KIND);
    expect(draft.content).toBe(LIKE);
    expect(draft.tags).toContainEqual(["a", TARGET.coordinate]);
    expect(record.addToDiscussion).toHaveBeenCalledTimes(1);
    expect(mocks.writeRelays).toHaveBeenCalledWith(me, { addressed: [author], hints: [] });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 7 }), RELAYS);
    expect(mocks.rememberLike).toHaveBeenCalledWith(TARGET.coordinate, 1);
    // The record now says what the click said, so there is nothing left to want.
    expect(intentsState()).toEqual({});
  });

  it("tells the listings about a like, and about nothing else", async () => {
    hold("ready", [tally(LIKE, { [me]: "a".repeat(64) })]);
    setReaction(me, TARGET, LIKE, false);
    await flush();
    expect(mocks.rememberLike).toHaveBeenCalledWith(TARGET.coordinate, -1);

    mocks.rememberLike.mockClear();
    setReaction(me, TARGET, "🔥", true);
    setReaction(me, { id: "e".repeat(64), pubkey: bob, kind: 1111 }, LIKE, true);
    hold("ready", []);
    record.box.state = {
      ...(record.box.state as object),
      byComment: { ["e".repeat(64)]: { reactions: [], zapSats: 0 } },
    };
    await flush();
    expect(mocks.rememberLike).not.toHaveBeenCalled();
  });

  it("retracts the like the record holds for this key", async () => {
    hold("ready", [tally(LIKE, { [me]: "a".repeat(64), [bob]: "b".repeat(64) })]);
    setReaction(me, TARGET, LIKE, false);

    expect(withIntent(reactions(), me, TARGET, intentsState())[0]?.count).toBe(1);
    await flush();

    const draft = mocks.signDraft.mock.calls[0]?.[0];
    expect(draft.kind).toBe(DELETION_KIND);
    expect(draft.tags).toContainEqual(["e", "a".repeat(64)]);
    expect(reactions()[0]?.by).toEqual({ [bob]: "b".repeat(64) });
    expect(intentsState()).toEqual({});
  });

  it("signs nothing when the record already agrees", async () => {
    hold("ready", [tally(LIKE, { [me]: "a".repeat(64) })]);
    setReaction(me, TARGET, LIKE, true);
    await flush();

    expect(mocks.signDraft).not.toHaveBeenCalled();
    expect(intentsState()).toEqual({});
  });

  it("waits for the record, then acts on it", async () => {
    hold("loading", []);
    setReaction(me, TARGET, LIKE, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.signDraft).not.toHaveBeenCalled();
    expect(intentsState()).toEqual({ [KEY]: true });

    hold("ready", [tally(LIKE, { [bob]: "b".repeat(64) })]);
    await flush();
    expect(kinds()).toEqual([REACTION_KIND]);
  });

  it("stops waiting for relays that never list what they hold", async () => {
    hold("loading", []);
    setReaction(me, TARGET, LIKE, true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(mocks.signDraft).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(kinds()).toEqual([REACTION_KIND]);
  });

  it("lands on the last of two quick clicks with one like and one retraction", async () => {
    let release: () => void = () => {};
    mocks.signDraft.mockImplementationOnce(
      (draft) =>
        new Promise((resolve) => {
          release = () => resolve(sign(draft));
        }),
    );

    setReaction(me, TARGET, LIKE, true);
    setReaction(me, TARGET, LIKE, false);
    expect(withIntent(reactions(), me, TARGET, intentsState())).toEqual([]);

    release();
    await flush();

    expect(kinds()).toEqual([REACTION_KIND, DELETION_KIND]);
    const retraction = mocks.signDraft.mock.calls[1]?.[0];
    expect(retraction.tags).toContainEqual(["e", "1".padStart(64, "0")]);
    expect(reactions()).toEqual([]);
    expect(intentsState()).toEqual({});
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });

  it("dates each signature after the one before it, so no two share an id", async () => {
    setReaction(me, TARGET, LIKE, true);
    await flush();
    setReaction(me, TARGET, LIKE, false);
    await flush();
    setReaction(me, TARGET, LIKE, true);
    await flush();

    const dates = mocks.signDraft.mock.calls.map((call) => call[0].created_at);
    expect(dates).toEqual([1_700_000_000, 1_700_000_001, 1_700_000_002]);
  });

  it("takes the click back when the signer refuses", async () => {
    const heard = vi.fn();
    subscribeIntents(heard);
    mocks.signDraft.mockRejectedValueOnce(new Error("cancelled"));

    setReaction(me, TARGET, LIKE, true);
    await flush();

    expect(intentsState()).toEqual({});
    expect(withIntent([], me, TARGET, intentsState())).toEqual([]);
    expect(record.addToDiscussion).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalled();
  });

  it("falls back to the relays this site reads when no list can be fetched", async () => {
    mocks.writeRelays.mockRejectedValueOnce(new Error("offline"));
    setReaction(me, TARGET, LIKE, true);
    await flush();

    const relays = mocks.enqueue.mock.calls[0]?.[1] as string[];
    expect(relays).toEqual(relaySet(DISCUSSION_RELAYS, DEFAULT_RELAYS));
  });

  it("forgets a click made about a document the record has moved on from", async () => {
    mocks.signDraft.mockReturnValue(new Promise(() => {}));
    hold("loading", []);
    setReaction(me, TARGET, LIKE, true);

    record.box.state = {
      coordinate: `${SPEC_KIND}:${author}:another`,
      status: "ready",
      document: { reactions: [], zapSats: 0 },
      byComment: {},
    };
    for (const listener of record.listeners) listener();

    expect(intentsState()).toEqual({});
    expect(mocks.signDraft).not.toHaveBeenCalled();
  });
});

describe("withIntent", () => {
  it("adds a pending like ahead of the others and a pending emoji after them", () => {
    const held = [tally("🔥", { [bob]: "b".repeat(64) })];
    expect(
      withIntent(held, me, TARGET, { [KEY]: true }).map((each) => [each.symbol, each.count]),
    ).toEqual([
      [LIKE, 1],
      ["🔥", 1],
    ]);
    expect(
      withIntent(held, me, TARGET, { [reactionKey(TARGET, "🤔")]: true }).map(
        (each) => each.symbol,
      ),
    ).toEqual(["🔥", "🤔"]);
  });

  it("removes a pending retraction, and the chip with it when nobody is left", () => {
    const held = [tally(LIKE, { [me]: "a".repeat(64), [bob]: "b".repeat(64) })];
    expect(withIntent(held, me, TARGET, { [KEY]: false })[0]?.by).toEqual({
      [bob]: "b".repeat(64),
    });
    expect(
      withIntent([tally(LIKE, { [me]: "a".repeat(64) })], me, TARGET, { [KEY]: false }),
    ).toEqual([]);
  });

  it("changes nothing when the record already says what the click said", () => {
    const held = [tally(LIKE, { [me]: "a".repeat(64) })];
    expect(withIntent(held, me, TARGET, { [KEY]: true })).toBe(held);
    expect(withIntent([], me, TARGET, { [KEY]: false })).toEqual([]);
  });

  it("leaves another target's clicks out", () => {
    const other = reactionKey({ id: "e".repeat(64) }, LIKE);
    expect(withIntent([], me, TARGET, { [other]: true })).toEqual([]);
  });
});
