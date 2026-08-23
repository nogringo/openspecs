import { parseSpec, SPEC_KIND } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { buildImport, CLIENT, type ImportSource } from "../src/document.ts";
import type { Corpus, SpecEntry } from "../src/manifest.ts";

const corpus: Corpus = {
  name: "buds",
  title: "Blossom Upgrade Documents",
  npub: "npub1zvm2zlskr58g4u4k3m54454y087r30hedgtavyn75q4yp55dm9lqz4932r",
  repo: "https://github.com/hzrd149/blossom",
  branch: "master",
  license: "Unlicense",
  topics: ["blossom", "bud"],
  pubkey: "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e",
  specs: [],
};

const entry: SpecEntry = {
  file: "buds/03.md",
  d: "bud-03",
  title: "BUD-03: User Server List",
  status: "draft",
  summary: "Where a user lists the servers holding their blobs.",
  kinds: [{ kind: 10063, name: "User server list" }],
};

const source: ImportSource = {
  commit: "b5bd2801d1763aa635fc8fea7a76597e0eb18990",
  publishedAt: 1708455998,
  createdAt: 1775927115,
  sha256: "aac0c1c5b0364352494064e2a9da74147e8b1101bcf65f7136ee4d86d1fd4053",
};

const built = buildImport(corpus, entry, "# BUD-03\n", source);

const tag = (name: string) => built.tags.find((tag) => tag[0] === name);

/** parseSpec takes an event, not a draft, and reads no signature to do it. */
const signed = {
  ...built,
  id: "a".repeat(64),
  pubkey: corpus.pubkey,
  sig: "b".repeat(128),
};

describe("buildImport", () => {
  it("stands the revision at the moment of its commit", () => {
    expect(built.kind).toBe(SPEC_KIND);
    expect(built.created_at).toBe(source.createdAt);
    expect(tag("published_at")).toEqual(["published_at", String(source.publishedAt)]);
  });

  it("names the file it copies, and the bytes it copied", () => {
    expect(tag("proxy")).toEqual([
      "proxy",
      "https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/03.md",
      "web",
    ]);
    expect(tag("x")).toEqual(["x", source.sha256]);
    expect(tag("client")).toEqual(["client", CLIENT]);
  });

  it("reads back through the schema the site reads", () => {
    const spec = parseSpec(signed);
    expect(spec).not.toBeNull();
    expect(spec?.identifier).toBe(entry.d);
    expect(spec?.title).toBe(entry.title);
    expect(spec?.titleIsDerived).toBe(false);
    expect(spec?.summary).toBe(entry.summary);
    expect(spec?.summaryIsDerived).toBe(false);
    expect(spec?.status).toBe("draft");
    expect(spec?.topics).toEqual(corpus.topics);
    expect(spec?.kinds).toEqual([{ raw: "10063", kind: 10063, name: "User server list" }]);
    expect(spec?.publishedAt).toBe(source.publishedAt);
    expect(spec?.isEmpty).toBe(false);
  });

  it("leaves out a status the document does not claim", () => {
    const without = buildImport(corpus, { ...entry, status: null }, "# BUD-03\n", source);
    expect(without.tags.some((tag) => tag[0] === "s")).toBe(false);
  });
});
