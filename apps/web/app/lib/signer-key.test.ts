import { npubEncode, nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import {
  decryptSecretKey,
  encryptSecretKey,
  keySigner,
  parseSecretKey,
  publicKeyOf,
} from "./signer-key";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);

/** The real cost takes about a second a call, which is a minute of suite for nothing. */
const CHEAP = 8;

describe("parseSecretKey", () => {
  it("takes an nsec", () => {
    expect(parseSecretKey(nsecEncode(secret))).toEqual(secret);
  });

  it("takes a bare hex key, however it was pasted", () => {
    expect(parseSecretKey(bytesToHex(secret))).toEqual(secret);
    expect(parseSecretKey(`  ${bytesToHex(secret).toUpperCase()}  `)).toEqual(secret);
  });

  it("refuses a public key, which is the paste that would otherwise look like it worked", () => {
    expect(parseSecretKey(npubEncode(pubkey))).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseSecretKey("")).toBeNull();
    expect(parseSecretKey("hunter2")).toBeNull();
    expect(parseSecretKey("nsec1notarealkey")).toBeNull();
  });
});

describe("a key kept under a passphrase", () => {
  it("comes back the key it went in as", async () => {
    const ncryptsec = await encryptSecretKey(secret, "correct horse battery", CHEAP);
    expect(ncryptsec.startsWith("ncryptsec1")).toBe(true);
    expect(await decryptSecretKey(ncryptsec, "correct horse battery")).toEqual(secret);
  });

  it("does not come back for the wrong passphrase", async () => {
    const ncryptsec = await encryptSecretKey(secret, "correct horse battery", CHEAP);
    await expect(decryptSecretKey(ncryptsec, "correct horse")).rejects.toThrow();
  });

  it("is never the key itself, whatever it is stored in", async () => {
    const ncryptsec = await encryptSecretKey(secret, "correct horse battery", CHEAP);
    expect(ncryptsec).not.toContain(bytesToHex(secret));
  });
});

describe("keySigner", () => {
  it("signs as the key it was given", async () => {
    const signer = keySigner(secret);
    expect(await signer.getPublicKey()).toBe(pubkey);
    expect(publicKeyOf(secret)).toBe(pubkey);

    const signed = await signer.signEvent({
      kind: 1111,
      content: "a comment",
      tags: [],
      created_at: 1_700_000_000,
    });
    expect(signed.pubkey).toBe(pubkey);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
  });
});
