import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({ subscribeNotices: vi.fn() }));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

vi.mock("./relays", () => ({ noticeRelays: vi.fn(async () => []) }));

import { buildComment, type NostrEvent, SPEC_KIND } from "@openspecs/nostr";
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

/** The one subscription, held so a test can play the relays' part by hand. */
type Channel = { send: (event: NostrEvent) => void; eose: () => void };

let channel: Channel;
let closed = 0;

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", fakeStorage());
  vi.useFakeTimers();
  clearNotices();
  forgetSeen();
  closed = 0;
  nostr.subscribeNotices.mockClear();

  nostr.subscribeNotices.mockImplementation((_pubkey, onEvent, options) => {
    channel = { send: onEvent, eose: () => options?.onEose?.() };
    return {
      close: () => {
        closed += 1;
      },
    };
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

    startNotices(SOMEBODY_ELSE);
    await settle();
    expect(closed).toBe(1);
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
    expect(closed).toBe(1);
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
