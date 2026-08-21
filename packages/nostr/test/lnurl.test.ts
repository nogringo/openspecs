import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInvoice, fetchPayEndpoint, type PayEndpoint, payUrl } from "../src/lnurl";
import { buildZapRequest } from "../src/nip57";

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response),
  );

describe("payUrl", () => {
  it("turns a lightning address into its well-known URL", () => {
    expect(payUrl("alice@example.com", null)).toBe("https://example.com/.well-known/lnurlp/alice");
  });

  it("takes the address however the profile wrote it", () => {
    expect(payUrl("  Alice@Example.com  ", null)).toBe(
      "https://example.com/.well-known/lnurlp/alice",
    );
    expect(payUrl("lightning:alice@example.com", null)).toBe(
      "https://example.com/.well-known/lnurlp/alice",
    );
  });

  it("decodes the older bech32 lnurl form to the same thing", () => {
    const encoded =
      "lnurl1dp68gurn8ghj7etcv9khqmr99e3k7mf09emk2mrv944kummhdchkcmn4wfk8qtmpd35kxeg9saevq";
    expect(payUrl(null, encoded)).toBe("https://example.com/.well-known/lnurlp/alice");
  });

  it("refuses an address that is not one", () => {
    expect(payUrl("not an address", null)).toBeNull();
    expect(payUrl("alice@localhost", null)).toBeNull();
    expect(payUrl(null, null)).toBeNull();
    expect(payUrl("", "")).toBeNull();
  });

  it("refuses an lnurl that decodes to something other than https", () => {
    expect(
      payUrl(
        null,
        "lnurl1dp68gup69uhk27rpd4cxcefwvdhk6tewwajkcmpdddhx7amw9akxuatjd3cz7ctvd93k2l0ryum",
      ),
    ).toBeNull();
  });
});

describe("fetchPayEndpoint", () => {
  it("reads what a server publishes about itself", async () => {
    answer({
      callback: "https://example.com/lnurlp/callback/alice",
      minSendable: 1000,
      maxSendable: 100_000_000,
      allowsNostr: true,
      nostrPubkey: "b".repeat(64),
      commentAllowed: 255,
    });

    const endpoint = await fetchPayEndpoint("alice@example.com");
    expect(endpoint?.callback).toBe("https://example.com/lnurlp/callback/alice");
    expect(endpoint?.allowsNostr).toBe(true);
    expect(endpoint?.nostrPubkey).toBe("b".repeat(64));
    expect(endpoint?.commentAllowed).toBe(255);
  });

  it("says a server will not sign a receipt rather than pretending it will", async () => {
    answer({ callback: "https://example.com/cb", allowsNostr: false, nostrPubkey: "b".repeat(64) });
    expect((await fetchPayEndpoint("alice@example.com"))?.allowsNostr).toBe(false);

    answer({ callback: "https://example.com/cb", allowsNostr: true });
    expect((await fetchPayEndpoint("alice@example.com"))?.allowsNostr).toBe(false);
  });

  it("refuses a callback that is not https", async () => {
    answer({ callback: "http://example.com/cb", allowsNostr: true });
    expect(await fetchPayEndpoint("alice@example.com")).toBeNull();
  });

  it("returns nothing rather than throwing when the server misbehaves", async () => {
    answer({ nope: true });
    expect(await fetchPayEndpoint("alice@example.com")).toBeNull();

    answer({}, false);
    expect(await fetchPayEndpoint("alice@example.com")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchPayEndpoint("alice@example.com")).toBeNull();
  });

  it("never asks a local host, whatever a profile claims", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    expect(await fetchPayEndpoint("alice@openspecs.local")).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });
});

const ENDPOINT: PayEndpoint = {
  callback: "https://example.com/lnurlp/callback/alice",
  minSendable: 1000,
  maxSendable: 100_000_000,
  allowsNostr: true,
  nostrPubkey: "b".repeat(64),
  commentAllowed: 255,
};

const zapRequest = finalizeEvent(
  {
    ...buildZapRequest({ target: { pubkey: "a".repeat(64) }, amountMsats: 21_000, relays: [] }),
    created_at: 1,
  },
  generateSecretKey(),
);

describe("fetchInvoice", () => {
  it("asks with the amount and the signed request, and takes the invoice", async () => {
    const fetched = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ pr: "lnbc210n1p..." }) });
    vi.stubGlobal("fetch", fetched);

    const result = await fetchInvoice({ endpoint: ENDPOINT, amountMsats: 21_000, zapRequest });
    expect(result).toEqual({ invoice: "lnbc210n1p..." });

    const asked = new URL(fetched.mock.calls[0]?.[0]);
    expect(asked.searchParams.get("amount")).toBe("21000");
    expect(JSON.parse(asked.searchParams.get("nostr") ?? "{}").id).toBe(zapRequest.id);
  });

  it("hands back the words a server refused with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ERROR", reason: "amount is below the minimum" }),
      }),
    );

    expect(await fetchInvoice({ endpoint: ENDPOINT, amountMsats: 1, zapRequest })).toEqual({
      error: "amount is below the minimum",
    });
  });

  it("says so when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await fetchInvoice({ endpoint: ENDPOINT, amountMsats: 21_000, zapRequest });
    expect(result).toEqual({ error: "the server could not be reached" });
  });
});
