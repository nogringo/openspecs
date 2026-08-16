import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearProfileCache,
  fetchProfile,
  fetchProfiles,
  PROFILE_KIND,
  type ProfileOptions,
  parseProfile,
  selectProfiles,
} from "../src/profile";
import { events } from "./fixtures";

const secretKey = generateSecretKey();
const author = getPublicKey(secretKey);

const profileEvent = (metadata: unknown, createdAt = 1_700_000_000) =>
  finalizeEvent(
    {
      kind: PROFILE_KIND,
      created_at: createdAt,
      tags: [],
      content: typeof metadata === "string" ? metadata : JSON.stringify(metadata),
    },
    secretKey,
  );

describe("parseProfile", () => {
  it("reads the fields a card is drawn from", () => {
    const profile = parseProfile(
      profileEvent({
        name: "alice",
        display_name: "Alice",
        picture: "https://example.com/alice.png",
        nip05: "alice@example.com",
        about: "ignored",
      }),
    );

    expect(profile).toEqual({
      pubkey: author,
      name: "Alice",
      picture: "https://example.com/alice.png",
      nip05: "alice@example.com",
      updatedAt: 1_700_000_000,
    });
  });

  it("falls back to the name when the display name is blank", () => {
    expect(parseProfile(profileEvent({ name: "alice", display_name: "   " }))?.name).toBe("alice");
    expect(parseProfile(profileEvent({ name: "alice" }))?.name).toBe("alice");
  });

  it("reads the camel cased spelling some clients write", () => {
    expect(parseProfile(profileEvent({ displayName: "Alice" }))?.name).toBe("Alice");
  });

  it("leaves an author who published nothing usable with an empty name", () => {
    const profile = parseProfile(profileEvent({}));
    expect(profile?.name).toBe("");
    expect(profile?.picture).toBeNull();
  });

  it("keeps what it can of a profile whose fields are the wrong type", () => {
    const profile = parseProfile(profileEvent({ name: "alice", picture: 42 }));
    expect(profile?.name).toBe("alice");
    expect(profile?.picture).toBeNull();
  });

  it("only follows an https picture", () => {
    const pictureOf = (picture: string) => parseProfile(profileEvent({ picture }))?.picture;

    expect(pictureOf("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(pictureOf("http://example.com/a.png")).toBeNull();
    expect(pictureOf("javascript:alert(1)")).toBeNull();
    expect(pictureOf("data:image/svg+xml,<svg onload='alert(1)'/>")).toBeNull();
    expect(pictureOf("/relative.png")).toBeNull();
    expect(pictureOf("   ")).toBeNull();
  });

  it("strips what would reorder the line the name sits on", () => {
    // U+202E is a right-to-left override, invisible in an editor and not in a browser.
    const profile = parseProfile(profileEvent({ name: "Ali‮ce\n\tSmith" }));
    expect(profile?.name).toBe("Ali ce Smith");
  });

  it("truncates a name that would run over the page", () => {
    const profile = parseProfile(profileEvent({ name: "a".repeat(500) }));
    expect(profile?.name).toHaveLength(67);
    expect(profile?.name.endsWith("...")).toBe(true);
  });

  it("rejects anything that is not a readable profile", () => {
    expect(parseProfile(profileEvent("not json at all"))).toBeNull();
    expect(parseProfile(profileEvent(""))).toBeNull();
    expect(parseProfile({ ...profileEvent({ name: "alice" }), kind: 1 })).toBeNull();
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile(events[0])).toBeNull();
  });
});

describe("selectProfiles", () => {
  it("keeps the newest revision per author", () => {
    const stale = profileEvent({ name: "The name an aggregator kept" }, 1_700_000_000);
    const live = profileEvent({ name: "The name published last" }, 1_700_000_100);

    expect(selectProfiles([live, stale]).get(author)?.name).toBe("The name published last");
    expect(selectProfiles([stale, live]).get(author)?.name).toBe("The name published last");
  });

  it("ignores anything that is not a profile", () => {
    expect(selectProfiles(events).size).toBe(0);
    expect(selectProfiles([null, {}, PROFILE_KIND]).size).toBe(0);
  });
});

/**
 * Read through a mock relay rather than a stubbed pool, so the pool, the
 * subscription and the relay URL are exercised too.
 */
let indexer: MockRelay;
let options: ProfileOptions;

beforeAll(async () => {
  indexer = createMockRelay();
  await indexer.start();
  indexer.seed([
    profileEvent({ name: "The name an aggregator kept" }, 1_700_000_000),
    profileEvent({ name: "The name published last" }, 1_700_000_100),
  ]);
  options = { indexers: [indexer.url ?? ""] };
});

afterAll(async () => {
  await indexer.stop();
});

beforeEach(clearProfileCache);

describe("fetchProfile", () => {
  it("returns the revision the author published last", async () => {
    expect((await fetchProfile(author, options))?.name).toBe("The name published last");
  });

  it("returns null for an author who published no profile", async () => {
    const stranger = getPublicKey(generateSecretKey());
    expect(await fetchProfile(stranger, options)).toBeNull();
  });

  it("keeps a profile it already resolved, even once the indexer is gone", async () => {
    const shortLived = createMockRelay();
    await shortLived.start();
    shortLived.seed([profileEvent({ name: "Alice" })]);
    const ownIndexer = { indexers: [shortLived.url ?? ""] };

    expect((await fetchProfile(author, ownIndexer))?.name).toBe("Alice");
    await shortLived.stop();
    expect((await fetchProfile(author, ownIndexer))?.name).toBe("Alice");
  });
});

describe("fetchProfiles", () => {
  it("asks for several authors at once and leaves out the ones with no profile", async () => {
    const stranger = getPublicKey(generateSecretKey());
    const profiles = await fetchProfiles([author, stranger, author], options);

    expect([...profiles.keys()]).toEqual([author]);
  });
});
