import {
  BLOSSOM_SERVER_KIND,
  PROFILE_KIND,
  parseProfile,
  parseRelayList,
  parseServerList,
  RELAY_LIST_KIND,
  toNpub,
} from "@openspecs/nostr";
import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { nsecEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  identityOf,
  profileOf,
  publishIdentity,
  relayListOf,
  serverListOf,
} from "../src/identity.ts";
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

const SERVERS = ["https://blossom.example", "https://elsewhere.example"];

const withPicture: Corpus = {
  ...corpus,
  blossom: { servers: SERVERS, picture: "c".repeat(64), banner: "d".repeat(64) },
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

  it("carries the picture the manifest recorded, and none when there is none", () => {
    expect(parseProfile(signed(profileOf(withPicture)))?.picture).toBe(
      `https://blossom.example/${"c".repeat(64)}.png`,
    );
    expect(profileOf(corpus).content).not.toContain("picture");
  });

  it("carries the banner the manifest recorded, and drops it when there is none", () => {
    expect(JSON.parse(profileOf(withPicture).content).banner).toBe(
      `https://blossom.example/${"d".repeat(64)}.png`,
    );
    expect(JSON.parse(profileOf(corpus).content)).not.toHaveProperty("banner");
  });

  it("says it is run by a machine, which is what a reader needs to know first", () => {
    expect(JSON.parse(profileOf(corpus).content).bot).toBe(true);
  });

  it("links to this key's own shelf rather than repeating the repository", () => {
    expect(JSON.parse(profileOf(corpus).content).website).toBe(
      `https://openspecs.uid.ovh/${corpus.npub}`,
    );
  });

  it("carries a lightning address for whoever keeps the copies running", () => {
    expect(parseProfile(signed(profileOf(corpus)))?.lud16).toBe("mongoose75@coinos.io");
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

describe("serverListOf", () => {
  it("names where the pictures are kept, so a dead address can be looked past", () => {
    expect(parseServerList(signed(serverListOf(SERVERS)))).toEqual(SERVERS);
  });

  it("names every server holding them, which is the one list the manifest keeps", () => {
    const [, , list] = identityOf(withPicture, ["wss://relay.example"]);
    expect(parseServerList(signed(list as Parameters<typeof signed>[0]))).toEqual(SERVERS);
  });
});

describe("identityOf", () => {
  it("is a profile and a relay list for a corpus with no picture", () => {
    expect(identityOf(corpus, ["wss://relay.example"]).map((draft) => draft.kind)).toEqual([
      PROFILE_KIND,
      RELAY_LIST_KIND,
    ]);
  });

  it("says where the picture is kept only once there is one", () => {
    expect(identityOf(withPicture, ["wss://relay.example"]).map((draft) => draft.kind)).toEqual([
      PROFILE_KIND,
      RELAY_LIST_KIND,
      BLOSSOM_SERVER_KIND,
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

  it("publishes the server list too, once the corpus has a picture", async () => {
    await publishIdentity({
      corpora: [{ ...mine, blossom: withPicture.blossom }],
      relays: ["wss://relay.openspecs.uid.ovh"],
      targets: [relay.url ?? ""],
      confirmed: true,
      env,
      pool,
    });
    expect(
      relay
        .getEvents()
        .map((event) => event.kind)
        .sort((a, b) => a - b),
    ).toEqual([PROFILE_KIND, RELAY_LIST_KIND, BLOSSOM_SERVER_KIND]);
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
