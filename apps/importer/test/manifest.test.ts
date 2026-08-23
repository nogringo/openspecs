import { describe, expect, it } from "vitest";
import { loadManifest, loadManifests } from "../src/manifest.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

describe("loadManifests", () => {
  it("reads the three corpora", async () => {
    const corpora = await loadManifests();
    expect(corpora.map((corpus) => corpus.name)).toEqual(["buds", "nips", "nuts"]);
    expect(corpora.map((corpus) => corpus.specs.length)).toEqual([13, 94, 31]);
  });

  it("resolves every npub to a key of its own", async () => {
    const corpora = await loadManifests();
    const keys = corpora.map((corpus) => corpus.pubkey);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a document once, and a file once", async () => {
    for (const corpus of await loadManifests()) {
      const ids = corpus.specs.map((spec) => spec.d);
      const files = corpus.specs.map((spec) => spec.file);
      expect(new Set(ids).size, corpus.name).toBe(ids.length);
      expect(new Set(files).size, corpus.name).toBe(files.length);
    }
  });

  it("gives every document a title, a summary and an identifier that reads as a path", async () => {
    for (const corpus of await loadManifests()) {
      for (const spec of corpus.specs) {
        expect(spec.d, spec.file).toMatch(/^[a-z0-9-]+$/);
        expect(spec.title.length, spec.d).toBeGreaterThan(0);
        expect(spec.summary.length, spec.d).toBeGreaterThan(0);
      }
    }
  });

  it("refuses a manifest that lists one identifier twice", async () => {
    await expect(loadManifest("dupe", FIXTURES)).rejects.toThrow(/twice/);
  });
});
