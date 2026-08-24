import { parseSpec, SPEC_KIND, toNpub } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { type SpotBase, spotsOf } from "./spots";

const BASE_KEY = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const OTHER = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const THIRD = "3556a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";

const CONTENT = "# NIP-00\n\nOne says a full sentence.\n\nTwo says a full sentence.";

const base: SpotBase = {
  content: CONTENT,
  title: "NIP-00",
  npub: toNpub(BASE_KEY),
  identifier: "nip-00",
};

const specOf = (pubkey: string, content: string) => {
  const spec = parseSpec({
    id: "a".repeat(64),
    pubkey,
    created_at: 1,
    kind: SPEC_KIND,
    tags: [["d", "nip-00"]],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

describe("spotsOf", () => {
  it("marks a changed paragraph at its rendered element, past the dropped title", () => {
    // The title heading is block 0 but the page drops it, so the second
    // paragraph is the page's element 1.
    const other = specOf(OTHER, CONTENT.replace("Two says", "Two now says"));
    const spots = spotsOf(base, [other]);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.element).toBe(1);
    expect(spots[0]?.entries[0]).toMatchObject({
      pubkey: OTHER,
      diffHref: `/spec/${base.npub}/nip-00/diff/${toNpub(OTHER)}`,
    });
    expect(spots[0]?.entries[0]?.html).toContain("<ins>");
  });

  it("groups two keys touching the same passage into one spot", () => {
    const spots = spotsOf(base, [
      specOf(OTHER, CONTENT.replace("Two says", "Two now says")),
      specOf(THIRD, CONTENT.replace("Two says", "Two also says")),
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.entries.map((entry) => entry.pubkey)).toEqual([OTHER, THIRD]);
  });

  it("marks nothing for a copy below the kinship floor", () => {
    const other = specOf(OTHER, "Entirely different words about an unrelated idea altogether.");
    expect(spotsOf(base, [other])).toEqual([]);
  });

  it("marks blocks added before everything at element minus one", () => {
    const other = specOf(OTHER, `A fresh opening block.\n\n${CONTENT}`);
    const spots = spotsOf(base, [other]);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.element).toBe(-1);
  });

  it("keeps two separated passages as two spots, in reading order", () => {
    const between = `${CONTENT}\n\nThree stays put in both copies.\n\nFour says a full sentence.`;
    const other = specOf(
      OTHER,
      between.replace("One says", "One now says").replace("Four says", "Four now says"),
    );
    const spots = spotsOf({ ...base, content: between }, [other]);
    expect(spots.map((spot) => spot.element)).toEqual([0, 3]);
  });

  it("covers a contiguous run of changed passages with one spot", () => {
    const other = specOf(
      OTHER,
      CONTENT.replace("One says", "One now says").replace("Two says", "Two now says"),
    );
    const spots = spotsOf(base, [other]);
    expect(spots.map((spot) => spot.element)).toEqual([0]);
  });
});
