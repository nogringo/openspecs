import {
  PROFILE_KIND,
  parseProfile,
  parseRelayList,
  RELAY_LIST_KIND,
  toNpub,
} from "@openspecs/nostr";
import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { nsecEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityOf, profileOf, publishIdentity, relayListOf } from "../src/identity.ts";
import { keyVariable } from "../src/keys.ts";
import type { Corpus } from "../src/manifest.ts";

const corpus: Corpus = {
  name: "nips",
  title: "Nostr Implementation Possibilities",
  npub: "npub19vumfllx9yeal9cwrymxcgkpuzf0j5lc8l876a2wpuzdtga5t8usdm3xgr",
  repo: "https://github.com/nostr-protocol/nips",
  branch: "master",
  license: "public domain",
  topics: ["nostr", "nip"],
  pubkey: "2b39b4ffe62933df970e19366c22c1e092f953f83fcfed754e0f04d5a3b459f9",
  specs: [],
};

const signed = (draft: { kind: number; content: string; tags: string[][] }) => ({
  ...draft,
  id: "a".repeat(64),
  pubkey: corpus.pubkey,
  created_at: 1,
  sig: "b".repeat(128),
});

describe("profileOf", () => {
  it("says it is a mirror in the name, where a client will show it", () => {
    const profile = parseProfile(signed(profileOf(corpus)));
    expect(profile?.name).toBe("Nostr Implementation Possibilities (mirror)");
  });

  it("names the repository it copies and the licence of what it copied", () => {
    const { content } = profileOf(corpus);
    expect(content).toContain("https://github.com/nostr-protocol/nips");
    expect(content).toContain("public domain");
    expect(content).toContain("did not write them");
  });
});

describe("relayListOf", () => {
  it("names where the corpus is published, for reading and for writing", () => {
    const list = parseRelayList(signed(relayListOf(["wss://relay.openspecs.uid.ovh"])));
    expect(list?.write).toEqual(["wss://relay.openspecs.uid.ovh/"]);
    expect(list?.read).toEqual(["wss://relay.openspecs.uid.ovh/"]);
  });
});

describe("identityOf", () => {
  it("is a profile and a relay list, and nothing else", () => {
    expect(identityOf(corpus, ["wss://relay.example"]).map((draft) => draft.kind)).toEqual([
      PROFILE_KIND,
      RELAY_LIST_KIND,
    ]);
  });
});

describe("publishIdentity", () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const mine: Corpus = { ...corpus, pubkey, npub: toNpub(pubkey) };
  const env = { [keyVariable(corpus.name)]: nsecEncode(secret) };

  let relay: MockRelay;
  let pool: SimplePool;

  const publish = (confirmed = true) =>
    publishIdentity({
      corpora: [mine],
      relays: ["wss://relay.openspecs.uid.ovh"],
      targets: [relay.url ?? ""],
      confirmed,
      env,
      pool,
    });

  beforeEach(async () => {
    relay = createMockRelay();
    await relay.start();
    pool = new SimplePool();
  });

  afterEach(async () => {
    pool.close([relay.url ?? ""]);
    await relay.stop();
  });

  it("publishes a profile and a relay list", async () => {
    await publish();
    expect(
      relay
        .getEvents()
        .map((event) => event.kind)
        .sort(),
    ).toEqual([PROFILE_KIND, RELAY_LIST_KIND]);
  });

  it("says nothing twice", async () => {
    await publish();
    await publish();
    expect(relay.getEvents()).toHaveLength(2);
  });

  it("sends nothing without a key, and nothing until it is told to", async () => {
    await publishIdentity({
      corpora: [mine],
      relays: ["wss://relay.openspecs.uid.ovh"],
      targets: [relay.url ?? ""],
      confirmed: false,
      env: {},
      pool,
    });
    expect(relay.getEvents()).toHaveLength(0);
  });
});
