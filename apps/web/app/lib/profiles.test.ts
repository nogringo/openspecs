import type { Profile } from "@openspecs/nostr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorsState, clearAuthors, subscribeAuthors, wantAuthors } from "./profiles";

const fetchProfiles = vi.hoisted(() => vi.fn());
vi.mock("@openspecs/nostr", () => ({ fetchProfiles }));

const profile = (pubkey: string, name: string, picture: string | null = null): Profile => ({
  pubkey,
  name,
  picture,
  nip05: null,
  updatedAt: 1_700_000_000,
});

const served = (...profiles: Profile[]) =>
  new Map(profiles.map((entry) => [entry.pubkey, entry] as const));

/** The store only runs in a browser, and the suite is a Node one. */
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
  clearAuthors();
  fetchProfiles.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The batch is collected on a timer, and the fetch it starts is a promise. */
const settle = async () => {
  await vi.runAllTimersAsync();
};

describe("wantAuthors", () => {
  it("asks for the keys that appeared together in one go", async () => {
    fetchProfiles.mockResolvedValue(served(profile("a", "Alice"), profile("b", "Bob")));

    wantAuthors(["a"]);
    wantAuthors(["b"]);
    await settle();

    expect(fetchProfiles).toHaveBeenCalledTimes(1);
    expect(fetchProfiles).toHaveBeenCalledWith(["a", "b"]);
    expect(authorsState().a?.name).toBe("Alice");
    expect(authorsState().b?.name).toBe("Bob");
  });

  it("asks for a key once, however many results it turns up under", async () => {
    fetchProfiles.mockResolvedValue(served(profile("a", "Alice")));

    wantAuthors(["a"]);
    await settle();
    wantAuthors(["a", "a"]);
    await settle();

    expect(fetchProfiles).toHaveBeenCalledTimes(1);
  });

  it("tells its listeners once the profiles are in", async () => {
    fetchProfiles.mockResolvedValue(served(profile("a", "Alice")));
    const listener = vi.fn();
    subscribeAuthors(listener);

    wantAuthors(["a"]);
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves out an author with nothing to show", async () => {
    fetchProfiles.mockResolvedValue(served(profile("a", "")));
    const listener = vi.fn();
    subscribeAuthors(listener);

    wantAuthors(["a"]);
    await settle();

    expect(authorsState().a).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("leaves every row its mark when the relays did not answer", async () => {
    fetchProfiles.mockRejectedValue(new Error("relays down"));

    wantAuthors(["a"]);
    await settle();

    expect(authorsState()).toEqual({});
  });
});
