import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({
  subscribeNotices: vi.fn(),
  subscribeCopies: vi.fn(),
  subscribeRetractions: vi.fn(),
  subscribeNamed: vi.fn(),
  fetchSpecs: vi.fn(),
}));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

vi.mock("./relays", () => ({ noticeRelays: vi.fn(async () => []) }));

import {
  buildComment,
  buildReaction,
  buildRetraction,
  COMMENT_KIND,
  type NostrEvent,
  parseSpec,
  SPEC_KIND,
  type Spec,
} from "@openspecs/nostr";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  clearNotices,
  markNoticesSeen,
  noticesState,
  startNotices,
  subscribeNoticesState,
} from "./notifications";
import { forgetSeen, noteKey, seenAt } from "./seen";

const myKey = generateSecretKey();
const ME = getPublicKey(myKey);

const theirKey = generateSecretKey();

const otherKey = generateSecretKey();
const SOMEBODY_ELSE = getPublicKey(otherKey);

const ROOT = { coordinate: `${SPEC_KIND}:${ME}:a-specification`, pubkey: ME };

const comment = (content: string, at: number) =>
  finalizeEvent({ ...buildComment({ root: ROOT, content }), created_at: at }, theirKey);

const specEvent = (
  by: Uint8Array,
  identifier: string,
  { at = 100, content = "# A copy" } = {},
): NostrEvent =>
  finalizeEvent(
    {
      kind: SPEC_KIND,
      content,
      created_at: at,
      tags: [
        ["d", identifier],
        ["title", "A copy"],
      ],
    },
    by,
  ) as NostrEvent;

const asSpec = (event: NostrEvent): Spec => {
  const spec = parseSpec(event);
  if (spec === null) throw new Error("fixture is not a specification");
  return spec;
};

/** A fake with the one behaviour that matters: it can be written to and read back. */
const fakeStorage = (): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => held.set(key, value),
    removeItem: (key: string) => held.delete(key),
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

const sign = (
  draft: { kind: number; content: string; tags: string[][] },
  by: Uint8Array,
  at = 100,
) => finalizeEvent({ ...draft, created_at: at }, by) as NostrEvent;

/** The one subscription, held so a test can play the relays' part by hand. */
type Channel = { send: (event: NostrEvent) => void; eose: () => void };

let channel: Channel;
/** The copy subscription, opened only once my own documents are known. */
let copyChannel: Channel | null;
/** Whichever of the two second passes was opened last. */
let secondPass: Channel | null;
/** Every subscription the store opened, and every one it closed again. */
let opened = 0;
let closed = 0;

/** What a mocked subscription hands back, counted so nothing can be leaked. */
const handle = () => {
  opened += 1;
  return {
    close: () => {
      closed += 1;
    },
  };
};

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", fakeStorage());
  vi.useFakeTimers();
  clearNotices();
  forgetSeen();
  opened = 0;
  closed = 0;
  copyChannel = null;
  secondPass = null;
  nostr.subscribeNotices.mockClear();
  nostr.subscribeCopies.mockClear();
  nostr.subscribeRetractions.mockClear();
  nostr.subscribeNamed.mockClear();

  // The two second passes deliver on the same channel the first one does, so a
  // test plays them by holding on to the callback they were opened with.
  for (const second of [nostr.subscribeRetractions, nostr.subscribeNamed]) {
    second.mockImplementation((_ids, onEvent) => {
      secondPass = { send: onEvent, eose: () => {} };
      return handle();
    });
  }
  nostr.fetchSpecs.mockReset();
  // Nobody has published anything unless a test says so.
  nostr.fetchSpecs.mockResolvedValue([]);

  nostr.subscribeCopies.mockImplementation((_names, onEvent, options) => {
    copyChannel = { send: onEvent, eose: () => options?.onEose?.() };
    return handle();
  });

  nostr.subscribeNotices.mockImplementation((_pubkey, onEvent, options) => {
    channel = { send: onEvent, eose: () => options?.onEose?.() };
    return handle();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The relay client is fetched, and the store batches: neither is instant. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(200);
};

describe("startNotices", () => {
  it("opens one subscription for a key", async () => {
    startNotices(ME);
    await settle();
    expect(nostr.subscribeNotices).toHaveBeenCalledTimes(1);
    expect(noticesState().me).toBe(ME);
  });

  it("does not open a second for the same key, however often the header remounts", async () => {
    startNotices(ME);
    await settle();
    startNotices(ME);
    startNotices(ME);
    await settle();
    expect(nostr.subscribeNotices).toHaveBeenCalledTimes(1);
    expect(closed).toBe(0);
  });

  it("closes what it held and forgets it when another key connects", async () => {
    startNotices(ME);
    await settle();
    channel.send(comment("a note", 2_000) as NostrEvent);
    await settle();
    expect(noticesState().notices).toHaveLength(1);

    // Everything the previous key had open, second passes included, is closed.
    const hadOpen = opened;
    startNotices(SOMEBODY_ELSE);
    await settle();
    expect(closed).toBe(hadOpen);
    expect(noticesState().me).toBe(SOMEBODY_ELSE);
    expect(noticesState().notices).toEqual([]);
  });

  it("says nothing on a server, where there is no browser to read it", () => {
    vi.stubGlobal("window", undefined);
    startNotices(ME);
    expect(nostr.subscribeNotices).not.toHaveBeenCalled();
  });

  it("is loading until the relays have listed what they hold", async () => {
    startNotices(ME);
    await settle();
    expect(noticesState().status).toBe("loading");

    channel.eose();
    await settle();
    expect(noticesState().status).toBe("ready");
  });

  it("tells a subscriber that something arrived", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNoticesState(listener);
    startNotices(ME);
    await settle();
    listener.mockClear();

    channel.send(comment("a note", 2_000) as NostrEvent);
    await settle();
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });
});

describe("the badge", () => {
  it("counts nothing for a key this browser has never seen", async () => {
    startNotices(ME);
    await settle();
    // Everything on the relays predates the moment this key connected here.
    channel.send(comment("old news", 1_000) as NostrEvent);
    await settle();

    expect(noticesState().notices).toHaveLength(1);
    expect(noticesState().unread).toBe(0);
  });

  it("counts what arrived after the key was last shown its news", async () => {
    noteKey(ME, 1_000);
    startNotices(ME);
    await settle();

    channel.send(comment("old news", 500) as NostrEvent);
    channel.send(comment("news", 2_000) as NostrEvent);
    await settle();

    expect(noticesState().notices).toHaveLength(2);
    expect(noticesState().unread).toBe(1);
  });
});

describe("markNoticesSeen", () => {
  it("clears the badge and holds the mark against a reload", async () => {
    noteKey(ME, 1_000);
    startNotices(ME);
    await settle();
    channel.send(comment("news", 2_000) as NostrEvent);
    await settle();

    markNoticesSeen();
    expect(noticesState().unread).toBe(0);
    expect(seenAt(ME)).toBe(2_000);
  });

  it("marks up to the newest it drew, not up to the clock", async () => {
    noteKey(ME, 1_000);
    startNotices(ME);
    await settle();
    channel.send(comment("news", 2_000) as NostrEvent);
    await settle();

    markNoticesSeen();
    // A relay serving an event dated later must still be able to raise the badge.
    channel.send(comment("dated tomorrow", 9_000) as NostrEvent);
    await settle();
    expect(noticesState().unread).toBe(1);
  });

  it("does nothing when nobody is connected", () => {
    expect(() => markNoticesSeen()).not.toThrow();
  });
});

describe("clearNotices", () => {
  it("closes the subscription and empties the bell on signing out", async () => {
    startNotices(ME);
    await settle();
    channel.send(comment("news", 2_000) as NostrEvent);
    await settle();

    clearNotices();
    expect(closed).toBe(opened);
    expect(noticesState().me).toBeNull();
    expect(noticesState().notices).toEqual([]);
  });

  it("leaves the mark where it is, since it belongs to the key and not the session", async () => {
    noteKey(ME, 1_000);
    startNotices(ME);
    await settle();
    channel.send(comment("news", 2_000) as NostrEvent);
    await settle();
    markNoticesSeen();

    clearNotices();
    expect(seenAt(ME)).toBe(2_000);
  });
});

describe("copies under one of my names", () => {
  const mineNamed = (identifier: string) => asSpec(specEvent(myKey, identifier));

  /**
   * Throws rather than shrugging when the copy subscription was never opened: a
   * test expecting no row must fail when nothing was ever sent to it.
   */
  const sendCopy = (event: NostrEvent) => {
    if (copyChannel === null) throw new Error("the copy subscription was never opened");
    copyChannel.send(event);
  };

  it("watches the names I publish under, and nothing else", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07"), mineNamed("nip-46")]);
    startNotices(ME);
    await settle();

    expect(nostr.subscribeCopies).toHaveBeenCalledTimes(1);
    const watched = (nostr.subscribeCopies.mock.calls[0]?.[0] ?? []) as string[];
    expect([...watched].sort()).toEqual(["nip-07", "nip-46"]);
  });

  it("leaves out a name I withdrew, since a document that is gone has no copies", async () => {
    const withdrawn = asSpec(specEvent(myKey, "nip-46", { content: "" }));
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07"), withdrawn]);
    startNotices(ME);
    await settle();

    expect(nostr.subscribeCopies.mock.calls[0]?.[0]).toEqual(["nip-07"]);
  });

  it("opens nothing at all for a key that has published nothing", async () => {
    startNotices(ME);
    await settle();
    expect(nostr.subscribeCopies).not.toHaveBeenCalled();
  });

  it("draws another key publishing under one of my names", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000 }));
    await settle();

    const [notice] = noticesState().notices;
    expect(notice?.kind).toBe("copy");
    expect(notice?.document.identifier).toBe("nip-07");
    // Their copy, not mine: the row leads to the document it is about.
    expect(notice?.document.pubkey).not.toBe(ME);
  });

  it("takes a copy revised twice as one row, dated by the newer revision", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000 }));
    sendCopy(specEvent(theirKey, "nip-07", { at: 3_000 }));
    await settle();

    expect(noticesState().notices).toHaveLength(1);
    expect(noticesState().notices[0]?.createdAt).toBe(3_000);
  });

  it("keeps the newest when an older revision arrives last, as relays serve them", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "nip-07", { at: 3_000 }));
    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000 }));
    await settle();

    expect(noticesState().notices).toHaveLength(1);
    expect(noticesState().notices[0]?.createdAt).toBe(3_000);
  });

  it("draws two keys under the same name as two rows", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000 }));
    sendCopy(specEvent(otherKey, "nip-07", { at: 2_100 }));
    await settle();

    expect(noticesState().notices).toHaveLength(2);
  });

  it("says nothing about my own revisions", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(myKey, "nip-07", { at: 2_000 }));
    await settle();

    expect(noticesState().notices).toEqual([]);
  });

  it("drops a copy under a name that is not one of mine, whatever the filter matched", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "some-other-name", { at: 2_000 }));
    await settle();

    expect(noticesState().notices).toEqual([]);
  });

  it("drops a copy its author withdrew", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();

    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000, content: "" }));
    await settle();

    expect(noticesState().notices).toEqual([]);
  });

  it("forgets the copies and the names when another key connects", async () => {
    nostr.fetchSpecs.mockResolvedValue([mineNamed("nip-07")]);
    startNotices(ME);
    await settle();
    sendCopy(specEvent(theirKey, "nip-07", { at: 2_000 }));
    await settle();
    expect(noticesState().notices).toHaveLength(1);

    nostr.fetchSpecs.mockResolvedValue([]);
    startNotices(SOMEBODY_ELSE);
    await settle();
    expect(noticesState().notices).toEqual([]);
  });
});

describe("the second passes", () => {
  const ROOT_THEIRS = {
    coordinate: `${SPEC_KIND}:${SOMEBODY_ELSE}:their-doc`,
    pubkey: SOMEBODY_ELSE,
  };

  const send = (channel: Channel | null, event: NostrEvent, what: string) => {
    if (channel === null) throw new Error(`the ${what} subscription was never opened`);
    channel.send(event);
  };

  it("asks whether what arrived is still standing", async () => {
    startNotices(ME);
    await settle();
    const written = comment("a note", 2_000) as NostrEvent;
    channel.send(written);
    await settle();

    expect(nostr.subscribeRetractions).toHaveBeenCalled();
    expect(nostr.subscribeRetractions.mock.calls[0]?.[0]).toContain(written.id);
  });

  it("asks about an id once and not again on the next event", async () => {
    startNotices(ME);
    await settle();
    channel.send(comment("one", 2_000) as NostrEvent);
    await settle();
    const asked = nostr.subscribeRetractions.mock.calls.length;

    channel.send(comment("two", 2_100) as NostrEvent);
    await settle();

    const second = nostr.subscribeRetractions.mock.calls[asked]?.[0] as string[] | undefined;
    expect(second).toHaveLength(1);
  });

  it("drops a row once the answer says its author took it back", async () => {
    startNotices(ME);
    await settle();
    const written = comment("a note", 2_000) as NostrEvent;
    channel.send(written);
    await settle();
    expect(noticesState().notices).toHaveLength(1);

    send(secondPass, sign(buildRetraction(written.id), theirKey, 2_100), "retraction");
    await settle();
    expect(noticesState().notices).toEqual([]);
  });

  it("resolves a reaction that named only an event id, and draws it", async () => {
    startNotices(ME);
    await settle();

    // My own comment on somebody else's document, and a reaction to it.
    const mine = finalizeEvent(
      { ...buildComment({ root: ROOT_THEIRS, content: "a point of mine" }), created_at: 1_900 },
      myKey,
    ) as NostrEvent;
    const reacted = sign(
      buildReaction({ id: mine.id, pubkey: ME, kind: COMMENT_KIND }, "+"),
      theirKey,
      2_000,
    );

    channel.send(reacted);
    await settle();
    // Nothing yet: the id names something this browser cannot see is mine.
    expect(noticesState().notices).toEqual([]);
    expect(nostr.subscribeNamed.mock.calls[0]?.[0]).toEqual([mine.id]);

    send(secondPass, mine, "named");
    await settle();

    const [notice] = noticesState().notices;
    expect(notice?.kind).toBe("reaction");
    expect(notice?.onComment).toBe(true);
  });

  it("leaves it dropped when the answer says the comment was somebody else's", async () => {
    startNotices(ME);
    await settle();

    const theirs = finalizeEvent(
      { ...buildComment({ root: ROOT_THEIRS, content: "not mine" }), created_at: 1_900 },
      theirKey,
    ) as NostrEvent;
    channel.send(
      sign(buildReaction({ id: theirs.id, pubkey: ME, kind: COMMENT_KIND }, "+"), otherKey, 2_000),
    );
    await settle();

    send(secondPass, theirs, "named");
    await settle();
    expect(noticesState().notices).toEqual([]);
  });
});
