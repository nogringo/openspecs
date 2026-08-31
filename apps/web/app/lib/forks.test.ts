import { parseSpec, SPEC_KIND, type Spec } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { selectForks } from "./forks";

const ORIGIN = { pubkey: "a".repeat(64), identifier: "nip-01" };
const COORDINATE = `${SPEC_KIND}:${ORIGIN.pubkey}:${ORIGIN.identifier}`;

const specOf = (pubkey: string, tags: string[][], content = "written", createdAt = 1): Spec => {
  const spec = parseSpec({
    id: `${pubkey.slice(0, 2)}${createdAt}`.padEnd(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: SPEC_KIND,
    tags,
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const forkedBy = (pubkey: string, identifier: string, createdAt = 1, marker = "fork") =>
  specOf(
    pubkey,
    [
      ["d", identifier],
      ["title", identifier],
      ["a", COORDINATE, "", marker],
    ],
    "written",
    createdAt,
  );

describe("selectForks", () => {
  it("keeps a document whatever its author renamed it to", () => {
    const found = selectForks([forkedBy("b".repeat(64), "nip-01-mine")], ORIGIN);
    expect(found.map((fork) => fork.identifier)).toEqual(["nip-01-mine"]);
    expect(found[0]?.sameName).toBe(false);
  });

  it("says when a fork kept the name, which puts it under this name too", () => {
    expect(selectForks([forkedBy("b".repeat(64), "nip-01")], ORIGIN)[0]?.sameName).toBe(true);
  });

  it("keeps out what only cites the coordinate", () => {
    // Relays index the tag's value and not the marker, so the query behind this
    // hands back every one of these.
    expect(selectForks([forkedBy("b".repeat(64), "x", 1, "update")], ORIGIN)).toEqual([]);
    expect(
      selectForks(
        [
          specOf("b".repeat(64), [
            ["d", "x"],
            ["title", "X"],
            ["a", COORDINATE],
          ]),
        ],
        ORIGIN,
      ),
    ).toEqual([]);
  });

  it("keeps out a fork of another document under the same name", () => {
    const other = `${SPEC_KIND}:${"c".repeat(64)}:nip-01`;
    const spec = specOf("b".repeat(64), [
      ["d", "x"],
      ["title", "X"],
      ["a", other, "", "fork"],
    ]);
    expect(selectForks([spec], ORIGIN)).toEqual([]);
  });

  it("keeps out the document itself and anything blank", () => {
    const itself = forkedBy(ORIGIN.pubkey, ORIGIN.identifier);
    const blank = specOf(
      "b".repeat(64),
      [
        ["d", "empty"],
        ["a", COORDINATE, "", "fork"],
      ],
      "  ",
    );
    expect(selectForks([itself, blank], ORIGIN)).toEqual([]);
  });

  it("puts the newest revision first", () => {
    const found = selectForks(
      [forkedBy("b".repeat(64), "older", 10), forkedBy("c".repeat(64), "newer", 20)],
      ORIGIN,
    );
    expect(found.map((fork) => fork.identifier)).toEqual(["newer", "older"]);
  });
});
