import { toNpub } from "@openspecs/nostr";
import { nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { keyVariable, secretFor } from "../src/keys.ts";
import type { Corpus } from "../src/manifest.ts";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);

const corpus: Corpus = {
  name: "buds",
  title: "Blossom Upgrade Documents",
  npub: toNpub(pubkey),
  repo: "https://github.com/hzrd149/blossom",
  branch: "master",
  license: "Unlicense",
  topics: ["blossom"],
  pubkey,
  specs: [],
};

describe("secretFor", () => {
  it("takes an nsec", () => {
    const env = { [keyVariable("buds")]: nsecEncode(secret) };
    expect(secretFor(corpus, env)).toEqual(secret);
  });

  it("takes the same key in hex", () => {
    const env = { [keyVariable("buds")]: bytesToHex(secret) };
    expect(secretFor(corpus, env)).toEqual(secret);
  });

  it("names the variable it wanted", () => {
    expect(() => secretFor(corpus, {})).toThrow(/OPENSPECS_IMPORT_KEY_BUDS/);
  });

  it("refuses to sign a corpus with a key that is not the one it names", () => {
    const other = generateSecretKey();
    const env = { [keyVariable("buds")]: nsecEncode(other) };
    expect(() => secretFor(corpus, env)).toThrow(toNpub(getPublicKey(other)));
    expect(() => secretFor(corpus, env)).toThrow(corpus.npub);
  });

  it("refuses anything that is not a key", () => {
    expect(() => secretFor(corpus, { [keyVariable("buds")]: "hunter2" })).toThrow(/nsec/);
  });
});
