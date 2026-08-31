import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const box: { state: { pubkey: string | null; status: string } } = {
    state: { pubkey: null, status: "locked" },
  };
  return { listeners, box };
});

const mocks = vi.hoisted(() => ({
  fetchMuteList: vi.fn(),
  muteListRelays: vi.fn(),
  outboxRelays: vi.fn(),
  signDraft: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  fetchMuteList: mocks.fetchMuteList,
}));
vi.mock("./relays", () => ({
  muteListRelays: mocks.muteListRelays,
  outboxRelays: mocks.outboxRelays,
}));
vi.mock("./publish", () => ({ signDraft: mocks.signDraft }));
vi.mock("./outbox", () => ({ enqueue: mocks.enqueue }));
vi.mock("./session", () => ({
  sessionState: () => session.box.state,
  subscribeSession: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  },
}));

import { MUTE_LIST_KIND, type NostrEvent } from "@openspecs/nostr";
import { applyLive, block, blockedState, clearBlocked, unblock } from "./blocked";
import { clearMuteSync, startMuteSync, syncMuteList } from "./mute-list";
import { SessionLocked } from "./signer";

const ME = "1".repeat(64);
const ALICE = "2".repeat(64);
const BOB = "3".repeat(64);
const MINE = ["wss://mine.example/"];
const DEFAULTS = ["wss://site.example/"];

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

const list = (tags: string[][], at: number, content = ""): NostrEvent => ({
  id: String(at).padStart(64, "0"),
  pubkey: ME,
  created_at: at,
  kind: MUTE_LIST_KIND,
  tags,
  content,
  sig: "c".repeat(128),
});

/** What the relays answer: the newest list they hold, and who finished saying so. */
const relaysHold = (event: NostrEvent | null, answered: string[]) =>
  mocks.fetchMuteList.mockResolvedValue({ event, answered });

const connect = (pubkey: string | null, status = "ready") => {
  session.box.state = { pubkey, status };
  for (const listener of session.listeners) listener();
};

let signed = 0;
const signedDrafts = () => mocks.signDraft.mock.calls.map((call) => call[0]);
const tagsSigned = () =>
  signedDrafts().map((draft) => draft.tags.filter((tag: string[]) => tag[0] !== "client"));

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", fakeStorage());
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.clearAllMocks();
  clearBlocked();
  clearMuteSync();
  session.listeners.clear();
  session.box.state = { pubkey: null, status: "locked" };
  signed = 0;

  mocks.muteListRelays.mockResolvedValue([...MINE, ...DEFAULTS]);
  mocks.outboxRelays.mockResolvedValue(MINE);
  mocks.signDraft.mockImplementation(async (draft) => ({
    ...draft,
    id: `f${String(++signed).padStart(63, "0")}`,
    pubkey: ME,
    sig: "",
  }));
  relaysHold(null, [...MINE, ...DEFAULTS]);
});

afterEach(() => {
  clearMuteSync();
  clearBlocked();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what a round waits for", () => {
  it("signs nothing and merges nothing while no relay has answered", async () => {
    block({ type: "p", value: ALICE });
    relaysHold(list([["p", BOB]], 100), []);
    connect(ME);
    startMuteSync();
    await flush();

    expect(mocks.signDraft).not.toHaveBeenCalled();
    expect(blockedState().pubkeys.has(BOB)).toBe(false);
    expect(blockedState().owed).toHaveLength(1);
  });

  it("does not take a default relay's word for what my own relays hold", async () => {
    block({ type: "p", value: ALICE });
    relaysHold(null, DEFAULTS);
    connect(ME);
    startMuteSync();
    await flush();

    expect(mocks.signDraft).not.toHaveBeenCalled();
    expect(blockedState().owed).toHaveLength(1);
  });

  it("tries again a minute later", async () => {
    block({ type: "p", value: ALICE });
    relaysHold(null, []);
    connect(ME);
    startMuteSync();
    await flush();
    relaysHold(null, MINE);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.signDraft).toHaveBeenCalledTimes(1);
    expect(blockedState().owed).toEqual([]);
  });
});

describe("what a round signs", () => {
  it("starts a fresh list for a key that has none, once its relays have said so", async () => {
    block({ type: "p", value: ALICE });
    relaysHold(null, MINE);
    connect(ME);
    startMuteSync();
    await flush();

    expect(tagsSigned()).toEqual([[["p", ALICE]]]);
    expect(blockedState().owed).toEqual([]);
    expect(blockedState().published).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: MUTE_LIST_KIND }), [
      ...MINE,
      ...DEFAULTS,
    ]);
  });

  it("keeps every tag and the content of the live list, and dates the new one after it", async () => {
    const live = list(
      [
        ["p", BOB],
        ["word", "spoiler"],
      ],
      1_700_000_050,
      "abc=",
    );
    block({ type: "a", value: `30817:${ALICE}:custom` });
    relaysHold(live, MINE);
    connect(ME);
    startMuteSync();
    await flush();

    const draft = signedDrafts()[0];
    expect(draft.content).toBe("abc=");
    expect(draft.tags).toEqual([
      ["p", BOB],
      ["word", "spoiler"],
      ["a", `30817:${ALICE}:custom`],
      ["client", "Open Specs"],
    ]);
    expect(draft.created_at).toBe(1_700_000_051);
  });

  it("takes the live list in, as a union with what is here", async () => {
    block({ type: "p", value: ALICE });
    relaysHold(list([["p", BOB]], 100), MINE);
    connect(ME);
    startMuteSync();
    await flush();

    expect([...blockedState().pubkeys]).toEqual([ALICE, BOB]);
  });

  it("settles a removal of something the live list never held without signing", async () => {
    applyLive({ pubkeys: [ALICE], eventIds: [], coordinates: [] });
    unblock({ type: "p", value: ALICE });
    relaysHold(list([["p", BOB]], 100), MINE);
    connect(ME);
    startMuteSync();
    await flush();

    expect(mocks.signDraft).not.toHaveBeenCalled();
    expect(blockedState().owed).toEqual([]);
    expect(blockedState().pubkeys.has(ALICE)).toBe(false);
  });

  it("builds on what it signed last when a relay still serves the revision before", async () => {
    connect(ME);
    startMuteSync();
    await flush();
    block({ type: "p", value: ALICE });
    await flush();
    expect(tagsSigned()).toEqual([[["p", ALICE]]]);

    block({ type: "p", value: BOB });
    await flush();
    expect(tagsSigned()[1]).toEqual([
      ["p", ALICE],
      ["p", BOB],
    ]);
  });
});

describe("what a refused signature does", () => {
  it("keeps the debt for a key still under its passphrase, and pays it once the key opens", async () => {
    mocks.signDraft.mockRejectedValueOnce(new SessionLocked());
    block({ type: "p", value: ALICE });
    connect(ME, "locked");
    startMuteSync();
    await flush();
    expect(blockedState().owed).toHaveLength(1);

    connect(ME, "ready");
    await flush();
    expect(mocks.signDraft).toHaveBeenCalledTimes(2);
    expect(blockedState().owed).toEqual([]);
  });

  it("drops the debt when the reader said no, and keeps the blocks on this device", async () => {
    mocks.signDraft.mockRejectedValueOnce(new Error("user rejected"));
    block({ type: "p", value: ALICE });
    connect(ME);
    startMuteSync();
    await flush();

    expect(blockedState().owed).toEqual([]);
    expect(blockedState().pubkeys.has(ALICE)).toBe(true);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("when a round runs", () => {
  it("runs nothing while nobody is connected", async () => {
    block({ type: "p", value: ALICE });
    startMuteSync();
    await flush();
    expect(mocks.fetchMuteList).not.toHaveBeenCalled();
  });

  it("runs one round at a time, and once more for a click that landed mid-round", async () => {
    let answer: (read: { event: null; answered: string[] }) => void = () => {};
    mocks.fetchMuteList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    connect(ME);
    startMuteSync();
    await flush();
    block({ type: "p", value: ALICE });
    block({ type: "p", value: BOB });
    await flush();
    expect(mocks.fetchMuteList).toHaveBeenCalledTimes(1);

    answer({ event: null, answered: MINE });
    await flush();
    expect(mocks.fetchMuteList).toHaveBeenCalledTimes(2);
    expect(tagsSigned()).toEqual([
      [
        ["p", ALICE],
        ["p", BOB],
      ],
    ]);
  });

  it("forgets the last key's list when another connects", async () => {
    relaysHold(list([["p", BOB]], 100), MINE);
    connect(ME);
    startMuteSync();
    await flush();
    expect(blockedState().published).toBe(true);

    connect(null);
    expect(blockedState().published).toBe(false);
  });

  it("runs again when the browser comes back online", async () => {
    connect(ME);
    startMuteSync();
    await flush();
    const online = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "online",
    )?.[1] as () => void;

    online();
    await flush();
    expect(mocks.fetchMuteList).toHaveBeenCalledTimes(2);
  });

  it("can be asked for by hand", async () => {
    connect(ME);
    await syncMuteList();
    expect(mocks.fetchMuteList).toHaveBeenCalledTimes(1);
  });
});
