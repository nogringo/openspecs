import { describe, expect, it, vi } from "vitest";
import { createLoadCache, withDeadline } from "./cache.server";

const cacheOf = <T>(options?: Partial<Parameters<typeof createLoadCache<T>>[0]>) =>
  createLoadCache<T>({ max: 3, ttlMs: 1000, ...options });

describe("createLoadCache", () => {
  it("loads once and serves the result until it expires", async () => {
    const cache = cacheOf<string>();
    const load = vi.fn(async () => "a");

    await cache.get("k", load, 0);
    await cache.get("k", load, 999);
    expect(load).toHaveBeenCalledTimes(1);

    await cache.get("k", load, 1001);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent loads of the same key into one", async () => {
    const cache = cacheOf<string>();
    const load = vi.fn(() => Promise.resolve("a"));

    const [first, second] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect([first, second]).toEqual(["a", "a"]);
  });

  it("forgets a failed load instead of serving the failure", async () => {
    const cache = cacheOf<string>();
    const failing = vi.fn(() => Promise.reject(new Error("relay down")));

    await expect(cache.get("k", failing)).rejects.toThrow("relay down");
    await expect(cache.get("k", failing)).rejects.toThrow("relay down");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("expires a value on its own lifetime", async () => {
    const cache = cacheOf<string | null>({ ttlMsFor: (value) => (value === null ? 10 : 1000) });
    const load = vi.fn(async () => null);

    await cache.get("k", load, 0);
    await cache.get("k", load, 20);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops the least recently used entry once full", async () => {
    const cache = cacheOf<string>();
    const load = (value: string) => () => Promise.resolve(value);

    await cache.get("a", load("a"), 0);
    await cache.get("b", load("b"), 0);
    await cache.get("c", load("c"), 0);
    await cache.get("a", load("a"), 0);
    await cache.get("d", load("d"), 0);

    expect(cache.size).toBe(3);
    const reload = vi.fn(load("b"));
    await cache.get("b", reload, 0);
    expect(reload).toHaveBeenCalledTimes(1);

    const kept = vi.fn(load("a"));
    await cache.get("a", kept, 0);
    expect(kept).not.toHaveBeenCalled();
  });

  it("serves an expired value while one refresh loads behind it", async () => {
    const cache = cacheOf<string>({ staleMs: 5000 });
    await cache.get("k", async () => "old", 0);

    let release: (value: string) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await expect(cache.get("k", refresh, 2000)).resolves.toBe("old");
    await expect(cache.get("k", refresh, 2001)).resolves.toBe("old");
    expect(refresh).toHaveBeenCalledTimes(1);

    release("new");
    await flush();
    await expect(cache.get("k", refresh, 2002)).resolves.toBe("new");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale value when a refresh fails, and tries again on the next request", async () => {
    const cache = cacheOf<string>({ staleMs: 5000 });
    await cache.get("k", async () => "old", 0);
    const failing = vi.fn(() => Promise.reject(new Error("relay down")));

    await expect(cache.get("k", failing, 2000)).resolves.toBe("old");
    await flush();
    await expect(cache.get("k", failing, 2001)).resolves.toBe("old");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("waits for a fresh value once the stale window has passed", async () => {
    const cache = cacheOf<string>({ staleMs: 5000 });
    await cache.get("k", async () => "old", 0);

    await expect(cache.get("k", async () => "new", 6001)).resolves.toBe("new");
  });

  it("never serves stale a value its own window rules out", async () => {
    const cache = cacheOf<string | null>({
      staleMs: 5000,
      staleMsFor: (value) => (value === null ? 0 : 5000),
    });
    await cache.get("k", async () => null, 0);

    await expect(cache.get("k", async () => "found", 2000)).resolves.toBe("found");
  });

  it("serves a seeded value at once and loads behind it", async () => {
    const cache = cacheOf<string>({ staleMs: 5000 });
    cache.seed("k", () => "known", 0);

    let release: (value: string) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await expect(cache.get("k", load, 0)).resolves.toBe("known");
    expect(load).toHaveBeenCalledTimes(1);

    release("loaded");
    await flush();
    await expect(cache.get("k", load, 1)).resolves.toBe("loaded");
  });

  it("does not seed over a value it can still serve", async () => {
    const cache = cacheOf<string>({ staleMs: 5000 });
    await cache.get("k", async () => "loaded", 0);
    const known = vi.fn(() => "known");

    cache.seed("k", known, 3000);
    expect(known).not.toHaveBeenCalled();
    await expect(cache.get("k", async () => "again", 3000)).resolves.toBe("loaded");
  });

  it("seeds over a value past its stale window", async () => {
    const cache = cacheOf<string | null>({
      staleMs: 5000,
      staleMsFor: (value) => (value === null ? 0 : 5000),
    });
    await cache.get("k", async () => null, 0);

    cache.seed("k", () => "known", 2000);
    await expect(cache.get("k", async () => "loaded", 2000)).resolves.toBe("known");
  });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withDeadline", () => {
  it("returns the value when the work answers in time", async () => {
    await expect(withDeadline(Promise.resolve("a"), null, 50)).resolves.toBe("a");
  });

  it("returns the fallback when it does not", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("a"), 100);
    });
    await expect(withDeadline(slow, null, 1)).resolves.toBeNull();
  });

  it("does not reject when the work fails after the deadline", async () => {
    const failing = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("relay down")), 5);
    });
    await expect(
      withDeadline(
        failing.catch(() => null),
        null,
        1,
      ),
    ).resolves.toBeNull();
  });
});
