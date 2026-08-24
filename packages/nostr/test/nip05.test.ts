import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkNip05,
  clearNip05Cache,
  nip05Label,
  parseNip05Address,
  resolveNip05,
} from "../src/nip05";

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

describe("checkNip05", () => {
  const OTHER = "1".repeat(64);

  it("confirms an address the domain answers with that key", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: PUBKEY } }));
    expect(await checkNip05(PUBKEY, "alice@example.com")).toBe("confirmed");
  });

  it("contradicts an address the domain gives to somebody else", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: OTHER } }));
    expect(await checkNip05(PUBKEY, "alice@example.com")).toBe("contradicted");
  });

  /** NIP-05: a browser refused by CORS sees what it sees for a name nobody published. */
  it("cannot tell a silent domain from a name it does not carry", async () => {
    vi.stubGlobal("fetch", serving({ names: { bob: PUBKEY } }));
    expect(await checkNip05(PUBKEY, "alice@example.com")).toBe("unreachable");

    clearNip05Cache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("refused");
      }),
    );
    expect(await checkNip05(PUBKEY, "alice@example.com")).toBe("unreachable");
  });

  it("does not ask about an address no domain could answer for", async () => {
    const fetcher = serving({ names: { alice: PUBKEY } });
    vi.stubGlobal("fetch", fetcher);

    // The local part NIP-05 allows is `a-z0-9-_.` and nothing else.
    expect(await checkNip05(PUBKEY, "alice smith@example.com")).toBe("malformed");
    expect(await checkNip05(PUBKEY, "not an address")).toBe("malformed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads the key it is given however it is cased", async () => {
    vi.stubGlobal("fetch", serving({ names: { alice: PUBKEY } }));
    expect(await checkNip05(PUBKEY.toUpperCase(), "alice@example.com")).toBe("confirmed");
  });
});

describe("nip05Label", () => {
  /** NIP-05 asks that `_@domain` be shown and treated as the bare domain. */
  it("writes the root name out as the domain alone", () => {
    expect(nip05Label("_@example.com")).toBe("example.com");
    expect(nip05Label("example.com")).toBe("example.com");
  });

  it("leaves an ordinary address as it is, lowercased", () => {
    expect(nip05Label("Alice@Example.com")).toBe("alice@example.com");
  });

  it("hands back what it cannot read rather than dropping it", () => {
    expect(nip05Label("  not an address  ")).toBe("not an address");
  });
});
