import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extensionSigner, waitForExtension } from "./signer-extension";

const listeners = new Map<string, Set<() => void>>();

const fakeWindow = () => ({
  addEventListener: (name: string, listener: () => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
  },
  removeEventListener: (name: string, listener: () => void) => {
    listeners.get(name)?.delete(listener);
  },
});

const fire = (name: string) => {
  for (const listener of listeners.get(name) ?? []) listener();
};

const anExtension = { getPublicKey: vi.fn(), signEvent: vi.fn() };

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal("window", fakeWindow());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waitForExtension", () => {
  it("answers at once when one is already there", async () => {
    vi.stubGlobal("window", { ...fakeWindow(), nostr: anExtension });
    await expect(waitForExtension()).resolves.toBe(anExtension);
  });

  /** Some extensions inject after the page has hydrated, and announce nothing. */
  it("waits for one that arrives late", async () => {
    const waiting = waitForExtension();

    await vi.advanceTimersByTimeAsync(500);
    (window as unknown as { nostr?: unknown }).nostr = anExtension;
    await vi.advanceTimersByTimeAsync(200);

    await expect(waiting).resolves.toBe(anExtension);
  });

  /** Installing one in another tab, then coming back to this one. */
  it("looks again when the tab is returned to", async () => {
    const waiting = waitForExtension();

    (window as unknown as { nostr?: unknown }).nostr = anExtension;
    fire("visibilitychange");

    await expect(waiting).resolves.toBe(anExtension);
  });

  it("gives up rather than waiting forever", async () => {
    const waiting = waitForExtension(1000);
    await vi.advanceTimersByTimeAsync(1200);
    await expect(waiting).resolves.toBeNull();
  });

  it("leaves no timer and no listener behind on any path", async () => {
    const waiting = waitForExtension(1000);
    await vi.advanceTimersByTimeAsync(1200);
    await waiting;

    expect(listeners.get("visibilitychange")?.size ?? 0).toBe(0);
    expect(listeners.get("focus")?.size ?? 0).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers null on a server, where there is no window to look in", async () => {
    vi.stubGlobal("window", undefined);
    await expect(waitForExtension()).resolves.toBeNull();
  });
});

describe("extensionSigner", () => {
  /**
   * Several extensions prompt on `getPublicKey`, and an app that prompts while
   * its page is loading is one whose prompts get dismissed unread.
   */
  it("asks the extension nothing until it is asked to", async () => {
    vi.stubGlobal("window", { ...fakeWindow(), nostr: anExtension });
    await extensionSigner();
    expect(anExtension.getPublicKey).not.toHaveBeenCalled();
  });

  it("says so when no extension answered", async () => {
    // Watched before the clock moves, or the rejection lands with nobody holding it.
    const asserted = expect(extensionSigner(1000)).rejects.toThrow("no signing extension answered");
    await vi.advanceTimersByTimeAsync(1200);
    await asserted;
  });
});
