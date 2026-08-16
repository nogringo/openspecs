import { describe, expect, it } from "vitest";
import { parseSpecFilter } from "./filter";

const filterOf = (query: string) => parseSpecFilter(new URLSearchParams(query));

describe("parseSpecFilter", () => {
  it("reads a topic and a kind", () => {
    expect(filterOf("topic=Nostr&kind=30023")).toEqual({ topic: "nostr", kind: 30023 });
  });

  it("reads nothing out of nothing", () => {
    expect(filterOf("")).toEqual({});
  });

  it("drops a topic that could not be a tag", () => {
    for (const query of ["topic=not a topic", "topic=-x", "topic=", `topic=${"x".repeat(65)}`]) {
      expect(filterOf(query), query).toEqual({});
    }
  });

  it("drops a kind that is not a number", () => {
    for (const query of ["kind=abc", "kind=-1", "kind=3.5", "kind=99999999"]) {
      expect(filterOf(query), query).toEqual({});
    }
  });

  it("keeps the half that is valid", () => {
    expect(filterOf("topic=nostr&kind=abc")).toEqual({ topic: "nostr" });
  });
});
