import { parseSpec, SPEC_KIND, type Spec, toNpub } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { selectCopies } from "./copies";

const SHOWN = {
  pubkey: "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e",
  identifier: "nip-07",
};
const OTHER = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const THIRD = "3556a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const HERE = `${SPEC_KIND}:${SHOWN.pubkey}:${SHOWN.identifier}`;

const specOf = (
  pubkey: string,
  { identifier = SHOWN.identifier, content = "text", createdAt = 1, tags = [] as string[][] } = {},
): Spec => {
  const spec = parseSpec({
    id: `${pubkey.slice(0, 4)}${createdAt}`.padEnd(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags: [["d", identifier], ["title", "NIP-07"], ...tags],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const forkTag = (coordinate = HERE) => [["a", coordinate, "", "fork"]];

describe("selectCopies", () => {
  it("drops the key whose document the page already is", () => {
    const copies = selectCopies([specOf(SHOWN.pubkey), specOf(OTHER)], SHOWN);
    expect(copies.map((copy) => copy.pubkey)).toEqual([OTHER]);
  });

  it("drops blank records, the way listings do", () => {
    expect(selectCopies([specOf(OTHER, { content: "  " })], SHOWN)).toEqual([]);
  });

  it("takes a copy that renamed itself, on the strength of its tag", () => {
    const copies = selectCopies(
      [specOf(OTHER, { identifier: "nip-07-mine", tags: forkTag() })],
      SHOWN,
    );
    expect(copies.map((copy) => copy.identifier)).toEqual(["nip-07-mine"]);
    expect(copies[0]?.sameName).toBe(false);
  });

  it("takes a renamed copy signed by this document's own key", () => {
    const copies = selectCopies(
      [specOf(SHOWN.pubkey, { identifier: "nip-07-again", tags: forkTag() })],
      SHOWN,
    );
    expect(copies.map((copy) => copy.identifier)).toEqual(["nip-07-again"]);
  });

  it("lists a copy found both ways once", () => {
    const both = specOf(OTHER, { tags: forkTag() });
    expect(selectCopies([both, both], SHOWN).length).toBeGreaterThan(0);
    const copies = selectCopies([both], SHOWN);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.sameName).toBe(true);
  });

  it("keeps out what only cites the address", () => {
    // Relays index an `a` tag's value and not the marker after it, so the query
    // behind this hands back every one of these.
    expect(
      selectCopies([specOf(OTHER, { identifier: "x", tags: [["a", HERE, "", "update"]] })], SHOWN),
    ).toEqual([]);
    expect(selectCopies([specOf(OTHER, { identifier: "x", tags: [["a", HERE]] })], SHOWN)).toEqual(
      [],
    );
  });

  it("keeps out a fork of another document that shares this name", () => {
    const elsewhere = `${SPEC_KIND}:${THIRD}:${SHOWN.identifier}`;
    expect(
      selectCopies([specOf(OTHER, { identifier: "x", tags: forkTag(elsewhere) })], SHOWN),
    ).toEqual([]);
  });

  it("lists the newest revision first", () => {
    const copies = selectCopies(
      [specOf(OTHER, { createdAt: 1 }), specOf(THIRD, { createdAt: 2 })],
      SHOWN,
    );
    expect(copies.map((copy) => copy.pubkey)).toEqual([THIRD, OTHER]);
  });

  it("carries what a row draws", () => {
    const [copy] = selectCopies([specOf(OTHER, { createdAt: 7 })], SHOWN);
    expect(copy).toMatchObject({
      pubkey: OTHER,
      npub: toNpub(OTHER),
      identifier: "nip-07",
      title: "NIP-07",
      revisedAt: 7,
      path: `/spec/${toNpub(OTHER)}/nip-07`,
      sameName: true,
    });
  });
});
