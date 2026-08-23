import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toNpub } from "@openspecs/nostr";
import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { nsecEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImport } from "../src/document.ts";
import { keyVariable } from "../src/keys.ts";
import type { Corpus, SpecEntry } from "../src/manifest.ts";
import { publishEvents } from "../src/publish.ts";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const env = { [keyVariable("buds")]: nsecEncode(secret) };

const entries: SpecEntry[] = [
  { file: "buds/01.md", d: "bud-01", title: "One", status: "draft", summary: "First.", kinds: [] },
  { file: "buds/02.md", d: "bud-02", title: "Two", status: "draft", summary: "Second.", kinds: [] },
];

const corpus: Corpus = {
  name: "buds",
  title: "Blossom Upgrade Documents",
  npub: toNpub(pubkey),
  repo: "https://github.com/hzrd149/blossom",
  branch: "master",
  license: "Unlicense",
  topics: ["blossom"],
  pubkey,
  specs: entries,
};

const source = {
  commit: "b5bd2801d1763aa635fc8fea7a76597e0eb18990",
  publishedAt: 1708455998,
  createdAt: 1775927115,
  sha256: "aac0c1c5b0364352494064e2a9da74147e8b1101bcf65f7136ee4d86d1fd4053",
};

let relay: MockRelay;
let pool: SimplePool;
let events: string;

const publish = (confirmed = true) =>
  publishEvents({
    corpora: [corpus],
    events,
    relays: [relay.url ?? ""],
    confirmed,
    env,
    pool,
  });

const documents = () => relay.getEvents().filter((event) => event.kind === 30817);

const identifierOf = (event: { tags: string[][] }) =>
  event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";

beforeEach(async () => {
  relay = createMockRelay();
  await relay.start();
  pool = new SimplePool();
  events = await mkdtemp(join(tmpdir(), "openspecs-"));
  mkdirSync(join(events, corpus.name));
  for (const entry of entries) {
    const event = buildImport(corpus, entry, `# ${entry.title}\n`, source);
    await writeFile(join(events, corpus.name, `${entry.d}.json`), JSON.stringify(event));
  }
});

afterEach(async () => {
  pool.close([relay.url ?? ""]);
  await relay.stop();
});

describe("publishEvents", () => {
  it("sends nothing until it is told to", async () => {
    await publish(false);
    expect(documents()).toHaveLength(0);
  });

  it("plans without a key, so seeing what would be sent is the easy thing to do", async () => {
    await publishEvents({
      corpora: [corpus],
      events,
      relays: [relay.url ?? ""],
      confirmed: false,
      env: {},
      pool,
    });
    expect(documents()).toHaveLength(0);
  });

  it("signs every document with the key the manifest names", async () => {
    await publish();
    const sent = documents();
    expect(sent).toHaveLength(2);
    expect(sent.every((event) => event.pubkey === pubkey)).toBe(true);
    expect(sent.map(identifierOf).sort()).toEqual(["bud-01", "bud-02"]);
  });

  it("sends nothing on a second run, which is what makes running it again safe", async () => {
    await publish();
    await publish();
    expect(documents()).toHaveLength(2);
  });

  it("sends the one document that changed, and leaves the other where it was", async () => {
    await publish();
    const before = new Map(documents().map((event) => [identifierOf(event), event.id]));

    const path = join(events, corpus.name, "bud-02.json");
    const draft = JSON.parse(await readFile(path, "utf8"));
    draft.content = "# Two\n\nA sentence that was not there before.\n";
    await writeFile(path, JSON.stringify(draft));

    await publish();
    const after = new Map(documents().map((event) => [identifierOf(event), event]));
    expect(after.get("bud-01")?.id).toBe(before.get("bud-01"));
    expect(after.get("bud-02")?.id).not.toBe(before.get("bud-02"));
    expect(after.get("bud-02")?.content).toContain("was not there before");
  });

  it("stamps a revision past the one it replaces, so a relay keeps the newer", async () => {
    await publish();

    const path = join(events, corpus.name, "bud-01.json");
    const draft = JSON.parse(await readFile(path, "utf8"));
    draft.content = "# One\n\nRevised without a commit behind it.\n";
    await writeFile(path, JSON.stringify(draft));

    await publish();
    const held = documents().find((event) => identifierOf(event) === "bud-01");
    expect(held?.created_at).toBe(source.createdAt + 1);
    expect(held?.content).toContain("Revised without a commit");
  });

  it("refuses the whole run when a key is missing, before it sends anything", async () => {
    await expect(
      publishEvents({
        corpora: [corpus],
        events,
        relays: [relay.url ?? ""],
        confirmed: true,
        env: {},
        pool,
      }),
    ).rejects.toThrow(/OPENSPECS_IMPORT_KEY_BUDS/);
    expect(documents()).toHaveLength(0);
  });
});
