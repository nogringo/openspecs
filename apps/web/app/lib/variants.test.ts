import { parseSpec, SPEC_KIND, toNpub } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { selectVariants } from "./variants";

const SHOWN = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const OTHER = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const THIRD = "3556a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

const specOf = (pubkey: string, content = "text", createdAt = 1) => {
  const spec = parseSpec({
    id: "a".repeat(64),
    pubkey,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags: [
      ["d", "nip-07"],
      ["title", "NIP-07"],
    ],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

describe("selectVariants", () => {
  it("drops the key whose document the page already is", () => {
    const variants = selectVariants([specOf(SHOWN), specOf(OTHER)], SHOWN);
    expect(variants.map((variant) => variant.pubkey)).toEqual([OTHER]);
  });

  it("drops blank records, the way listings do", () => {
    expect(selectVariants([specOf(OTHER, "  ")], SHOWN)).toEqual([]);
  });

  it("lists the newest revision first", () => {
    const variants = selectVariants([specOf(OTHER, "text", 1), specOf(THIRD, "text", 2)], SHOWN);
    expect(variants.map((variant) => variant.pubkey)).toEqual([THIRD, OTHER]);
  });

  it("carries what a row draws", () => {
    const [variant] = selectVariants([specOf(OTHER, "text", 7)], SHOWN);
    expect(variant).toMatchObject({
      pubkey: OTHER,
      npub: toNpub(OTHER),
      title: "NIP-07",
      revisedAt: 7,
      path: `/spec/${toNpub(OTHER)}/nip-07`,
    });
  });
});
