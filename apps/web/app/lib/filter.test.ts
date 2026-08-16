import { describe, expect, it } from "vitest";
import { parseSearchQuery, parseSpecFilter } from "./filter";

const filterOf = (query: string) => parseSpecFilter(new URLSearchParams(query));
const searchOf = (query: string) => parseSearchQuery(new URLSearchParams(query));

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

  it("ignores a search query, which no relay can answer", () => {
    expect(filterOf("q=relay+discovery")).toEqual({});
  });
});

describe("parseSearchQuery", () => {
  it("reads what the visitor typed", () => {
    expect(searchOf("q=relay+discovery")).toBe("relay discovery");
  });

  it("keeps punctuation and case, which the search engine folds itself", () => {
    expect(searchOf("q=NIP-65%2C+r%C3%A9seau")).toBe("NIP-65, réseau");
  });

  it("tidies the spacing rather than the words", () => {
    expect(searchOf("q=++relay+++lists++")).toBe("relay lists");
  });

  it("reads nothing out of an absent or blank query", () => {
    for (const query of ["", "q=", "q=+++"]) {
      expect(searchOf(query), query).toBeUndefined();
    }
  });

  it("cuts a query no one meant to type", () => {
    expect(searchOf(`q=${"x".repeat(200)}`)).toHaveLength(100);
  });
});
