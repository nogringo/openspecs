import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSeen, markSeen, noteKey, parseSeen, seenAt, unreadCount } from "./seen";

const A = "a".repeat(64);
const B = "b".repeat(64);

/** A fake with the one behaviour that matters: it can be written to and read back. */
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

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("noteKey", () => {
  it("starts a key it has never seen counting from now, not from the beginning", () => {
    expect(seenAt(A)).toBeNull();
    expect(noteKey(A, 1_000)).toBe(1_000);
    expect(seenAt(A)).toBe(1_000);
  });

  it("leaves a mark it already holds where it is", () => {
    noteKey(A, 1_000);
    expect(noteKey(A, 9_000)).toBe(1_000);
  });

  it("keeps two keys apart", () => {
    noteKey(A, 1_000);
    noteKey(B, 2_000);
    expect([seenAt(A), seenAt(B)]).toEqual([1_000, 2_000]);
  });
});

describe("markSeen", () => {
  it("moves the mark forward", () => {
    noteKey(A, 1_000);
    markSeen(A, 2_000);
    expect(seenAt(A)).toBe(2_000);
  });

  it("never moves it back, whatever order two tabs write in", () => {
    noteKey(A, 1_000);
    markSeen(A, 2_000);
    markSeen(A, 1_500);
    expect(seenAt(A)).toBe(2_000);
  });

  it("ignores a number that is not one", () => {
    noteKey(A, 1_000);
    markSeen(A, Number.NaN);
    expect(seenAt(A)).toBe(1_000);
  });

  it("marks a key nothing noted yet, since the mark belongs to the key", () => {
    markSeen(B, 5_000);
    expect(seenAt(B)).toBe(5_000);
  });
});

describe("the record on disk", () => {
  it("survives a reload, which is the whole of what it is for", () => {
    noteKey(A, 1_000);
    markSeen(A, 4_000);
    expect(parseSeen(JSON.parse(localStorage.getItem("openspecs:seen") ?? "null"))?.at[A]).toBe(
      4_000,
    );
  });

  it("keeps the eight most recently read keys and drops the oldest", () => {
    const keys = "0123456789".split("").map((digit) => digit.repeat(64));
    keys.forEach((key, index) => {
      noteKey(key, 1_000 + index);
    });

    const held = Object.keys(
      parseSeen(JSON.parse(localStorage.getItem("openspecs:seen") ?? "null"))?.at ?? {},
    );
    expect(held).toHaveLength(8);
    expect(held).not.toContain(keys[0]);
    expect(held).toContain(keys[9]);
  });

  it("reads a record written by something else as no record at all", () => {
    localStorage.setItem("openspecs:seen", JSON.stringify({ v: 2, at: { [A]: 9_000 } }));
    expect(seenAt(A)).toBeNull();
  });

  it("reads junk as no record at all rather than throwing", () => {
    localStorage.setItem("openspecs:seen", "not json");
    expect(seenAt(A)).toBeNull();
  });

  it("drops an entry that is not a key and a time", () => {
    localStorage.setItem(
      "openspecs:seen",
      JSON.stringify({ v: 1, at: { "not-a-key": 1, [A]: "soon", [B]: 3_000 } }),
    );
    expect([seenAt(A), seenAt(B)]).toEqual([null, 3_000]);
  });

  it("counts from the beginning, rather than throwing, where storage is refused", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    expect(() => markSeen(A, 1_000)).not.toThrow();
    expect(seenAt(A)).toBeNull();
  });

  it("forgets everything when asked", () => {
    noteKey(A, 1_000);
    forgetSeen();
    expect(seenAt(A)).toBeNull();
  });
});

describe("unreadCount", () => {
  const notices = [{ createdAt: 100 }, { createdAt: 200 }, { createdAt: 300 }];

  it("counts strictly newer, so the event that set the mark is not counted twice", () => {
    expect(unreadCount(notices, 200)).toBe(1);
  });

  it("counts everything against a mark older than all of it", () => {
    expect(unreadCount(notices, 0)).toBe(3);
  });

  it("counts nothing once the mark has caught up", () => {
    expect(unreadCount(notices, 300)).toBe(0);
  });
});
