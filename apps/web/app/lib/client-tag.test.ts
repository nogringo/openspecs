import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Read once and kept, so every case needs the module as it is on a fresh page. */
const load = async () => {
  vi.resetModules();
  return await import("./client-tag");
};

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("namesClient", () => {
  it("is off for a browser that has never been asked", async () => {
    const { namesClient } = await load();
    expect(namesClient()).toBe(false);
  });

  it("is on again on the next page load, once it has been turned on", async () => {
    const first = await load();
    first.setNamesClient(true);
    expect(first.namesClient()).toBe(true);

    const second = await load();
    expect(second.namesClient()).toBe(true);
  });

  it("forgets it rather than storing a no", async () => {
    const { namesClient, setNamesClient } = await load();
    setNamesClient(true);
    setNamesClient(false);

    expect(namesClient()).toBe(false);
    expect(localStorage.getItem("openspecs:client-tag")).toBeNull();
  });

  /** Anything but the one word this writes is something else's, or something rotten. */
  it("reads a stored value it did not write as off", async () => {
    localStorage.setItem("openspecs:client-tag", "true");
    const { namesClient } = await load();
    expect(namesClient()).toBe(false);
  });

  it("stays off, rather than throwing, where storage is refused", async () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    const { namesClient, setNamesClient } = await load();

    expect(namesClient()).toBe(false);
    expect(() => setNamesClient(true)).not.toThrow();
    expect(namesClient()).toBe(true);
  });

  it("is off on a server, which signs nothing", async () => {
    const { serverNamesClient } = await load();
    expect(serverNamesClient()).toBe(false);
  });

  it("tells a subscriber that it changed", async () => {
    const { setNamesClient, subscribeClientTag } = await load();
    const listener = vi.fn();
    const unsubscribe = subscribeClientTag(listener);

    setNamesClient(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setNamesClient(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("withClientTag", () => {
  const TAGS = [
    ["A", "30817:x:y"],
    ["client", "openspecs"],
  ];

  it("takes the name off when it was never asked for", async () => {
    const { withClientTag } = await load();
    expect(withClientTag(TAGS)).toEqual([["A", "30817:x:y"]]);
  });

  it("leaves every tag where it was when it was", async () => {
    const { setNamesClient, withClientTag } = await load();
    setNamesClient(true);
    expect(withClientTag(TAGS)).toEqual(TAGS);
  });
});
