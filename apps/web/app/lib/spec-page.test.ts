import { parseSpec, SPEC_KIND, toNaddr, toNpub } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { toPage } from "./spec-page";

const PUBKEY = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

const specOf = (content: string) => {
  const spec = parseSpec({
    id: "a".repeat(64),
    pubkey: PUBKEY,
    created_at: 1,
    kind: SPEC_KIND,
    tags: [
      ["d", "bud-02"],
      ["title", "BUD-02"],
    ],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

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
