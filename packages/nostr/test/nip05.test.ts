import { afterEach, describe, expect, it, vi } from "vitest";
import { clearNip05Cache, parseNip05Address, resolveNip05 } from "../src/nip05";

const PUBKEY = "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";

const serving = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(
    async (_url: string | URL, _options?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200, ...init }),
  );

afterEach(() => {
  clearNip05Cache();
  vi.unstubAllGlobals();
});

describe("parseNip05Address", () => {
  it("reads a name and a domain", () => {
    expect(parseNip05Address("Alice@Example.com")).toEqual({
      name: "alice",
      domain: "example.com",
    });
  });

  it("reads a bare domain as the root name", () => {
    expect(parseNip05Address("example.com")).toEqual({ name: "_", domain: "example.com" });
  });

  it("rejects what is not an address", () => {
    for (const input of ["", "@example.com", "alice@", "a@b@c", "alice@example", "alice@-x.com"]) {
      expect(parseNip05Address(input), input).toBeNull();
    }
  });
});

describe("resolveNip05", () => {
  it("returns the key the domain publishes for that name", async () => {
    const fetcher = serving({
      names: { alice: PUBKEY },
      relays: { [PUBKEY]: ["wss://a.example"] },
    });
    vi.stubGlobal("fetch", fetcher);

    expect(await resolveNip05("alice@example.com")).toEqual({
      pubkey: PUBKEY,
      relays: ["wss://a.example"],
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.com/.well-known/nostr.json?name=alice",
    );
  });

  it("asks for the root name of a bare domain", async () => {
    const fetcher = serving({ names: { _: PUBKEY } });
    vi.stubGlobal("fetch", fetcher);

    expect(await resolveNip05("example.com")).toEqual({ pubkey: PUBKEY, relays: [] });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://example.com/.well-known/nostr.json?name=_");
  });

  it("refuses to follow a redirect, which NIP-05 forbids", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: PUBKEY } }));
    await resolveNip05("alice@example.com");
    expect((globalThis.fetch as ReturnType<typeof serving>).mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
    });
  });

  it("returns nothing for a name the domain does not carry", async () => {
    vi.stubGlobal("fetch", serving({ names: { bob: PUBKEY } }));
    expect(await resolveNip05("alice@example.com")).toBeNull();
  });

  it("returns nothing for a key that is not a key", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: "not-a-pubkey" } }));
    expect(await resolveNip05("alice@example.com")).toBeNull();
  });

  it("returns nothing when the domain answers with an error or with junk", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: PUBKEY } }, { status: 404 }));
    expect(await resolveNip05("alice@example.com")).toBeNull();

    clearNip05Cache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200 })),
    );
    expect(await resolveNip05("alice@example.com")).toBeNull();
  });

  it("survives a domain that does not answer at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await resolveNip05("alice@example.com")).toBeNull();
  });

  it("never asks a local hostname", async () => {
    const fetcher = serving({ names: { _: PUBKEY } });
    vi.stubGlobal("fetch", fetcher);

    expect(await resolveNip05("localhost")).toBeNull();
    expect(await resolveNip05("printer.local")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks a domain once, then serves the answer from memory", async () => {
    const fetcher = serving({ names: { alice: PUBKEY } });
    vi.stubGlobal("fetch", fetcher);

    await resolveNip05("alice@example.com");
    await resolveNip05("ALICE@example.com");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
