import { parseSpec, SPEC_KIND, toNaddr, toNpub } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { toPage } from "./spec-page";

const PUBKEY = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

const ORIGIN = "2447a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

const specWithTags = (tags: string[][], content = "") => {
  const spec = parseSpec({
    id: "a".repeat(64),
    pubkey: PUBKEY,
    created_at: 1,
    kind: SPEC_KIND,
    tags: [["d", "bud-02"], ["title", "BUD-02"], ...tags],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const specOf = (content: string) => specWithTags([], content);

describe("toPage", () => {
  const naddr = toNaddr({ pubkey: PUBKEY, identifier: "bud-01" });
  const path = `/spec/${toNpub(PUBKEY)}/bud-01`;

  it("points a reference at the document it addresses", () => {
    expect(toPage(specOf(`see [BUD-01](nostr:${naddr})`)).html).toContain(`href="${path}"`);
  });

  it("keeps the section a reference names", () => {
    expect(toPage(specOf(`[get](nostr:${naddr}#get-blob)`)).html).toContain(
      `href="${path}#get-blob"`,
    );
  });

  it("draws a reference standing in the text as a link too", () => {
    expect(toPage(specOf(`as nostr:${naddr} says`)).html).toContain(`href="${path}"`);
  });
});

describe("toPage and where a document says it came from", () => {
  const marker = (coordinate: string) => [["a", coordinate, "", "fork"]];

  it("names the origin by its address, without asking a relay for it", () => {
    expect(toPage(specWithTags(marker(`${SPEC_KIND}:${ORIGIN}:bud-02`))).forkedFrom).toEqual([
      {
        type: "spec",
        npub: toNpub(ORIGIN),
        identifier: "bud-02",
        path: `/spec/${toNpub(ORIGIN)}/bud-02`,
      },
    ]);
  });

  it("drops a coordinate that addresses nothing", () => {
    expect(toPage(specWithTags(marker("30817:not-a-key:bud-02"))).forkedFrom).toEqual([]);
    expect(toPage(specWithTags(marker(`${SPEC_KIND}:${ORIGIN}:`))).forkedFrom).toEqual([]);
  });

  it("reads only an `a` tag marked as a fork", () => {
    const coordinate = `${SPEC_KIND}:${ORIGIN}:bud-01`;
    // An `a` tag is also how another client says `update` or `extends`, and how a
    // documentation space names its pages.
    expect(toPage(specWithTags([["a", coordinate]])).forkedFrom).toEqual([]);
    expect(toPage(specWithTags([["a", coordinate, "", "update"]])).forkedFrom).toEqual([]);
    // The marker sits at index 3 on an `a` tag, where index 2 is the relay hint.
    expect(toPage(specWithTags([["a", coordinate, "fork"]])).forkedFrom).toEqual([]);
  });

  it("says nothing about a marker naming the document it sits on", () => {
    expect(toPage(specWithTags(marker(`${SPEC_KIND}:${PUBKEY}:bud-02`))).forkedFrom).toEqual([]);
  });

  it("names an origin outside Nostr by its host, without the www", () => {
    expect(
      toPage(specWithTags([["i", "https://www.example.org/nips/47", "fork"]])).forkedFrom,
    ).toEqual([{ type: "external", url: "https://www.example.org/nips/47", host: "example.org" }]);
  });

  it("drops an origin outside Nostr that no reader can open", () => {
    expect(toPage(specWithTags([["i", "javascript:alert(1)", "fork"]])).forkedFrom).toEqual([]);
    expect(toPage(specWithTags([["i", "not a url at all", "fork"]])).forkedFrom).toEqual([]);
  });
});
