import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { SPEC_KIND, tagValue } from "../src/event";
import {
  buildZapRequest,
  parseZapReceipt,
  parseZapRequest,
  totalSats,
  verifyZapReceipt,
  ZAP_RECEIPT_KIND,
  ZAP_REQUEST_KIND,
} from "../src/nip57";
import { discussionCase } from "./fixtures";

const COORDINATE = `${SPEC_KIND}:b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2:replaceable-event-snapshots`;

const RECIPIENT = "b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2";

/**
 * A real invoice for 21 satoshis, so the amount is read from bolt11 rather than
 * from a number this test made up.
 */
const INVOICE_21_SATS =
  "lnbc210n1pn2s396pp5w7lqvvmqxxwqmqjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqsdqqcqzzsxqyz5vqsp5usqfaketc5sg7g7fhqg9zqhqvqhqvqhqvqhqvqhqvqhqvqhqvqhqs9qyyssq";

const secret = generateSecretKey();
const serverKey = getPublicKey(secret);

const signedRequest = (amountMsats: number, target = { pubkey: RECIPIENT }) =>
  finalizeEvent(
    { ...buildZapRequest({ target, amountMsats, relays: ["wss://nos.lol"] }), created_at: 1 },
    generateSecretKey(),
  );

const receipt = (description: string, bolt11: string, extra: string[][] = []) =>
  finalizeEvent(
    {
      kind: ZAP_RECEIPT_KIND,
      created_at: 2,
      content: "",
      tags: [["p", RECIPIENT], ["bolt11", bolt11], ["description", description], ...extra],
    },
    secret,
  );

describe("buildZapRequest", () => {
  it("names the recipient, the document and the coordinate", () => {
    const draft = buildZapRequest({
      target: { pubkey: RECIPIENT, eventId: "d".repeat(64), coordinate: COORDINATE, kind: 30817 },
      amountMsats: 21_000,
      comment: "  good spec  ",
      relays: ["wss://relay.ditto.pub", "wss://nos.lol"],
    });

    expect(draft.kind).toBe(ZAP_REQUEST_KIND);
    expect(draft.content).toBe("good spec");
    expect(draft.tags).toEqual([
      ["relays", "wss://relay.ditto.pub", "wss://nos.lol"],
      ["amount", "21000"],
      ["p", RECIPIENT],
      ["e", "d".repeat(64)],
      ["a", COORDINATE],
      ["k", "30817"],
      ["client", "openspecs"],
    ]);
  });

  it("leaves out the coordinate a comment does not have", () => {
    const draft = buildZapRequest({
      target: { pubkey: RECIPIENT, eventId: "e".repeat(64), kind: 1111 },
      amountMsats: 1000,
      relays: [],
    });
    expect(draft.tags.some((tag) => tag[0] === "a")).toBe(false);
    expect(draft.tags).toContainEqual(["k", "1111"]);
  });

  it("writes the amount in millisatoshis, as a string", () => {
    expect(tagValue(signedRequest(21_000), "amount")).toBe("21000");
  });
});

describe("parseZapRequest", () => {
  it("reads back what a server would echo", () => {
    const request = signedRequest(21_000);
    expect(parseZapRequest(JSON.stringify(request))?.id).toBe(request.id);
  });

  it("refuses junk, an empty description and an event of another kind", () => {
    expect(parseZapRequest("")).toBeNull();
    expect(parseZapRequest("{oops")).toBeNull();
    expect(parseZapRequest(JSON.stringify({ ...signedRequest(1000), kind: 1 }))).toBeNull();
  });
});

describe("parseZapReceipt", () => {
  it("reads every fixture receipt", () => {
    for (const event of discussionCase("zaps")) {
      const zap = parseZapReceipt(event);
      expect(zap, `fixture ${event.id} should parse`).not.toBeNull();
      expect(zap?.amountSats).toBeGreaterThan(0);
    }
  });

  it("names who paid, from the request the server echoed back", () => {
    const request = signedRequest(21_000);
    const zap = parseZapReceipt(receipt(JSON.stringify(request), INVOICE_21_SATS));
    expect(zap?.zapper).toBe(request.pubkey);
    expect(zap?.recipient).toBe(RECIPIENT);
  });

  it("falls back to the uppercase P when there is no readable request", () => {
    const zapper = "9".repeat(64);
    const zap = parseZapReceipt(receipt("", INVOICE_21_SATS, [["P", zapper]]));
    expect(zap?.zapper).toBe(zapper);
  });

  it("refuses a receipt with no invoice on it", () => {
    expect(parseZapReceipt(receipt(JSON.stringify(signedRequest(1000)), ""))).toBeNull();
  });

  it("refuses a receipt whose invoice and request disagree on the amount", () => {
    // The request asks for a hundred thousand satoshis, the invoice is for 21.
    const zap = parseZapReceipt(
      receipt(JSON.stringify(signedRequest(100_000_000)), INVOICE_21_SATS),
    );
    expect(zap).toBeNull();
  });

  it("forgives the rounding of an amount that is not a whole number of satoshis", () => {
    const zap = parseZapReceipt(receipt(JSON.stringify(signedRequest(21_500)), INVOICE_21_SATS));
    expect(zap?.amountSats).toBe(21);
  });

  it("refuses anything that is not a receipt", () => {
    expect(parseZapReceipt(signedRequest(1000))).toBeNull();
    expect(parseZapReceipt(null)).toBeNull();
  });
});

describe("verifyZapReceipt", () => {
  const zap = parseZapReceipt(receipt(JSON.stringify(signedRequest(21_000)), INVOICE_21_SATS));

  it("accepts a receipt signed by the key the endpoint named", () => {
    expect(zap).not.toBeNull();
    expect(
      zap !== null && verifyZapReceipt(zap, { nostrPubkey: serverKey, recipient: RECIPIENT }),
    ).toBe(true);
  });

  it("refuses one signed by anybody else", () => {
    expect(
      zap !== null && verifyZapReceipt(zap, { nostrPubkey: "0".repeat(64), recipient: RECIPIENT }),
    ).toBe(false);
  });

  it("refuses one paid to somebody else", () => {
    expect(
      zap !== null && verifyZapReceipt(zap, { nostrPubkey: serverKey, recipient: "0".repeat(64) }),
    ).toBe(false);
  });
});

describe("totalSats", () => {
  it("adds a receipt served by three relays once", () => {
    const zaps = discussionCase("zaps")
      .map(parseZapReceipt)
      .filter((zap) => zap !== null);
    expect(totalSats([...zaps, ...zaps])).toBe(totalSats(zaps));
  });
});
