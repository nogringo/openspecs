import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLive,
  block,
  blockedState,
  clearBlocked,
  hidesComment,
  hidesSpec,
  isBlocked,
  markUnpublished,
  parseBlocked,
  pauseOwed,
  resumeOwed,
  settleOwed,
  subscribeBlocked,
  unblock,
} from "./blocked";

const ALICE = "1".repeat(64);
const BOB = "2".repeat(64);
const NOTE = "e".repeat(64);
const COORDINATE = `30817:${ALICE}:custom-xyz`;

const fakeStorage = (broken = false): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      return held.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.set(key, value);
    },
    removeItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.delete(key);
    },
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

const onDisk = () => parseBlocked(JSON.parse(localStorage.getItem("openspecs:blocked") ?? "null"));

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  clearBlocked();
});

afterEach(() => {
  clearBlocked();
  vi.unstubAllGlobals();
});

describe("block and unblock", () => {
  it("hides at once, and tells whoever is watching", () => {
    const heard = vi.fn();
    subscribeBlocked(heard);

    block({ type: "p", value: ALICE });
    expect(blockedState().pubkeys.has(ALICE)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("owes the relays what it changed, once per thing", () => {
    block({ type: "p", value: ALICE });
    block({ type: "p", value: ALICE });
    block({ type: "a", value: COORDINATE });
    expect(blockedState().owed).toEqual([
      { op: "add", type: "p", value: ALICE },
      { op: "add", type: "a", value: COORDINATE },
    ]);
  });

  it("owes nothing after a change of mind", () => {
    block({ type: "p", value: ALICE });
    unblock({ type: "p", value: ALICE });
    expect(blockedState().pubkeys.has(ALICE)).toBe(false);
    expect(blockedState().owed).toEqual([]);
  });

  it("owes a removal for something the live list gave it", () => {
    applyLive({ pubkeys: [ALICE], eventIds: [], coordinates: [] });
    unblock({ type: "p", value: ALICE });
    expect(blockedState().owed).toEqual([{ op: "remove", type: "p", value: ALICE }]);
  });

  it("refuses what is not a key, an id or a document", () => {
    block({ type: "p", value: "alice" });
    block({ type: "a", value: `30023:${ALICE}:an-article` });
    expect(blockedState()).toMatchObject({ owed: [] });
    expect(blockedState().pubkeys.size + blockedState().coordinates.size).toBe(0);
  });

  it("hands back the same snapshot until something changes", () => {
    const before = blockedState();
    expect(blockedState()).toBe(before);
    block({ type: "e", value: NOTE });
    expect(blockedState()).not.toBe(before);
  });
});

describe("what a block hides", () => {
  it("hides a document by its author and by its address", () => {
    block({ type: "p", value: ALICE });
    block({ type: "a", value: `30817:${BOB}:theirs` });
    const blocked = blockedState();

    expect(hidesSpec(blocked, { pubkey: ALICE, identifier: "anything" })).toBe(true);
    expect(hidesSpec(blocked, { pubkey: BOB, identifier: "theirs" })).toBe(true);
    expect(hidesSpec(blocked, { pubkey: BOB, identifier: "another" })).toBe(false);
  });

  it("hides a comment by its author and by its id", () => {
    block({ type: "p", value: ALICE });
    block({ type: "e", value: NOTE });
    const blocked = blockedState();

    expect(hidesComment(blocked, { id: "f".repeat(64), pubkey: ALICE })).toBe(true);
    expect(hidesComment(blocked, { id: NOTE, pubkey: BOB })).toBe(true);
    expect(hidesComment(blocked, { id: "f".repeat(64), pubkey: BOB })).toBe(false);
  });

  it("answers for one thing at a time", () => {
    block({ type: "e", value: NOTE });
    expect(isBlocked(blockedState(), { type: "e", value: NOTE })).toBe(true);
    expect(isBlocked(blockedState(), { type: "p", value: NOTE })).toBe(false);
  });
});

describe("the live list", () => {
  it("is added to what is here, never put in its place", () => {
    block({ type: "p", value: ALICE });
    applyLive({ pubkeys: [BOB], eventIds: [NOTE], coordinates: [COORDINATE] });
    const blocked = blockedState();

    expect([...blocked.pubkeys]).toEqual([ALICE, BOB]);
    expect([...blocked.eventIds]).toEqual([NOTE]);
    expect([...blocked.coordinates]).toEqual([COORDINATE]);
    expect(blocked.published).toBe(true);
    expect(blocked.owed).toEqual([{ op: "add", type: "p", value: ALICE }]);
  });

  it("does not put back what this device took out and has not yet said so", () => {
    applyLive({ pubkeys: [ALICE], eventIds: [], coordinates: [] });
    unblock({ type: "p", value: ALICE });
    applyLive({ pubkeys: [ALICE], eventIds: [], coordinates: [] });
    expect(blockedState().pubkeys.has(ALICE)).toBe(false);
  });

  it("drops what in it is not a key, an id or a document", () => {
    applyLive({ pubkeys: ["alice"], eventIds: [], coordinates: [`30023:${ALICE}:x`] });
    expect(blockedState().pubkeys.size + blockedState().coordinates.size).toBe(0);
  });

  it("is forgotten as published when the key changes", () => {
    applyLive({ pubkeys: [ALICE], eventIds: [], coordinates: [], hasPrivate: true });
    expect(blockedState().hasPrivate).toBe(true);

    markUnpublished();
    expect(blockedState().published).toBe(false);
    expect(blockedState().hasPrivate).toBe(false);
    expect(blockedState().pubkeys.has(ALICE)).toBe(true);
  });
});

describe("the debt", () => {
  it("is settled by what a signature carried, and only that", () => {
    block({ type: "p", value: ALICE });
    block({ type: "p", value: BOB });
    settleOwed([{ op: "add", type: "p", value: ALICE }]);
    expect(blockedState().owed).toEqual([{ op: "add", type: "p", value: BOB }]);
  });

  it("is kept when the signer refuses, and the blocks stay", () => {
    block({ type: "p", value: ALICE });
    pauseOwed();
    expect(blockedState().owed).toEqual([{ op: "add", type: "p", value: ALICE }]);
    expect(blockedState().refused).toBe(true);
    expect(blockedState().pubkeys.has(ALICE)).toBe(true);
  });

  it("waits, after a refusal, for the reader to ask again", () => {
    applyLive({ pubkeys: [BOB], eventIds: [], coordinates: [] });
    block({ type: "p", value: ALICE });
    pauseOwed();

    resumeOwed();
    expect(blockedState().refused).toBe(false);
    expect(blockedState().owed).toEqual([{ op: "add", type: "p", value: ALICE }]);
  });

  it("takes another block as the reader asking again", () => {
    block({ type: "p", value: ALICE });
    pauseOwed();

    block({ type: "a", value: COORDINATE });
    expect(blockedState().refused).toBe(false);
    expect(blockedState().owed).toEqual([
      { op: "add", type: "p", value: ALICE },
      { op: "add", type: "a", value: COORDINATE },
    ]);
  });
});

describe("the record on disk", () => {
  it("survives a reload, which is the whole of what it is for", () => {
    block({ type: "p", value: ALICE });
    block({ type: "e", value: NOTE });
    expect(onDisk()).toEqual({
      v: 1,
      p: [ALICE],
      e: [NOTE],
      a: [],
      owed: [
        { op: "add", type: "p", value: ALICE },
        { op: "add", type: "e", value: NOTE },
      ],
      refused: false,
    });
  });

  it("reads a record written by something else as nothing blocked", () => {
    localStorage.setItem("openspecs:blocked", JSON.stringify({ v: 2, p: [ALICE] }));
    expect(blockedState().pubkeys.size).toBe(0);
  });

  it("reads junk as nothing blocked rather than throwing", () => {
    localStorage.setItem("openspecs:blocked", "not json");
    expect(blockedState().pubkeys.size).toBe(0);
  });

  it("drops an entry that is not what its list holds", () => {
    localStorage.setItem(
      "openspecs:blocked",
      JSON.stringify({
        v: 1,
        p: [ALICE, "not-a-key", 3],
        e: "not a list",
        a: [COORDINATE, `30023:${ALICE}:x`],
        owed: [{ op: "add", type: "p", value: ALICE }, { op: "drop", type: "p", value: BOB }, null],
      }),
    );
    const blocked = blockedState();
    expect([...blocked.pubkeys]).toEqual([ALICE]);
    expect([...blocked.eventIds]).toEqual([]);
    expect([...blocked.coordinates]).toEqual([COORDINATE]);
    expect(blocked.owed).toEqual([{ op: "add", type: "p", value: ALICE }]);
  });

  it("still hides in memory where storage is refused", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    clearBlocked();
    expect(() => block({ type: "p", value: ALICE })).not.toThrow();
    expect(blockedState().pubkeys.has(ALICE)).toBe(true);
  });
});
