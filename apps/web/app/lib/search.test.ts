import { describe, expect, it } from "vitest";
import { matchSpans, type SearchDoc, searchDocs, searchTerms } from "./search";

const doc = (fields: Partial<SearchDoc> & { identifier: string }): SearchDoc => ({
  path: `/spec/npub1/${fields.identifier}`,
  title: "",
  summary: "",
  pubkey: "a".repeat(64),
  npub: "npub1",
  status: null,
  kinds: [],
  topics: [],
  publishedAt: 1_700_000_000,
  revisedAt: 1_700_000_000,
  content: "",
  ...fields,
});

const found = (docs: SearchDoc[], query: string): string[] =>
  searchDocs(docs, query).map((hit) => hit.doc.identifier);

describe("searchTerms", () => {
  it("folds accents away, so a word is spelled one way", () => {
    expect(searchTerms("Réseau")).toEqual(["reseau"]);
  });

  it("splits on anything that is not a letter or a digit", () => {
    expect(searchTerms("kind 30023, naddr!")).toEqual(["kind", "30023", "naddr"]);
  });

  it("says a word once", () => {
    expect(searchTerms("relay relay relay")).toEqual(["relay"]);
  });

  it("reads no term out of punctuation alone", () => {
    expect(searchTerms("  ...  ")).toEqual([]);
  });
});

describe("matchSpans", () => {
  const marked = (text: string, terms: string[]): string[] =>
    matchSpans(text, terms).map((span) => text.slice(span.at, span.at + span.length));

  it("marks a word wherever it appears", () => {
    expect(marked("Relay lists and relay hints", ["relay"])).toEqual(["Relay", "relay"]);
  });

  it("marks a word the accents were hiding", () => {
    expect(marked("Le réseau", ["reseau"])).toEqual(["réseau"]);
  });

  it("joins two words that touch into one mark", () => {
    expect(marked("relayhint", ["relay", "hint"])).toEqual(["relayhint"]);
  });

  it("marks nothing without a term", () => {
    expect(matchSpans("Relay", [])).toEqual([]);
  });

  it("keeps its place past the backticks a specification is full of", () => {
    // The backtick carries the Unicode Diacritic property, so folding it away
    // would shift every mark after it by one character.
    const text = "kind `32176` for payloads distributed via [Blossom](https://example.com)";
    expect(marked(text, ["blossom"])).toEqual(["Blossom"]);
  });

  it("keeps its place past a tilde and a caret too", () => {
    expect(marked("~~struck~~ and ^caret^ then relay", ["relay"])).toEqual(["relay"]);
  });
});

describe("searchDocs", () => {
  it("finds a word the accents were hiding", () => {
    const docs = [doc({ identifier: "a", title: "Le réseau", content: "" })];
    expect(found(docs, "reseau")).toEqual(["a"]);
    expect(found(docs, "réseau")).toEqual(["a"]);
  });

  it("finds a word that only exists in the body", () => {
    const docs = [
      doc({ identifier: "a", title: "Something else", content: "It mentions webhooks once." }),
      doc({ identifier: "b", title: "Something else again" }),
    ];
    expect(found(docs, "webhooks")).toEqual(["a"]);
  });

  it("narrows on a second word rather than widening", () => {
    const docs = [
      doc({ identifier: "both", title: "Relay discovery" }),
      doc({ identifier: "one", title: "Relay lists" }),
    ];
    expect(found(docs, "relay discovery")).toEqual(["both"]);
  });

  it("ranks a title above a summary, and a summary above a body", () => {
    const docs = [
      doc({ identifier: "body", content: "The word relay appears here." }),
      doc({ identifier: "title", title: "Relay" }),
      doc({ identifier: "summary", summary: "About the relay." }),
    ];
    expect(found(docs, "relay")).toEqual(["title", "summary", "body"]);
  });

  it("ranks a topic above a body", () => {
    const docs = [
      doc({ identifier: "body", content: "nostr nostr nostr nostr nostr nostr nostr" }),
      doc({ identifier: "topic", topics: ["nostr"] }),
    ];
    expect(found(docs, "nostr")).toEqual(["topic", "body"]);
  });

  it("prefers the newest of two documents that score the same", () => {
    const docs = [
      doc({ identifier: "old", title: "Relay", publishedAt: 1_700_000_000 }),
      doc({ identifier: "new", title: "Relay", publishedAt: 1_700_000_100 }),
    ];
    expect(found(docs, "relay")).toEqual(["new", "old"]);
  });

  it("puts a title that reads like the query first", () => {
    const docs = [
      doc({ identifier: "scattered", title: "Discovery of relays and event routing" }),
      doc({ identifier: "phrase", title: "Event discovery" }),
    ];
    expect(found(docs, "event discovery")).toEqual(["phrase", "scattered"]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchDocs([doc({ identifier: "a", title: "Relay" })], "   ")).toEqual([]);
  });

  it("returns the excerpt around the word it found", () => {
    const content = `${"filler ".repeat(60)}the webhook contract ${"filler ".repeat(60)}`;
    const [hit] = searchDocs([doc({ identifier: "a", content })], "webhook");

    expect(hit?.excerpt).toContain("the webhook contract");
    expect(hit?.excerpt.startsWith("...")).toBe(true);
    expect(hit?.excerpt.endsWith("...")).toBe(true);
    expect(hit?.excerpt.length).toBeLessThan(200);
  });

  it("reads the excerpt as prose rather than as markup", () => {
    const content = `${"filler ".repeat(40)}a **bold** \`webhook\` and a [link](https://example.com) here${"filler ".repeat(40)}`;
    const [hit] = searchDocs([doc({ identifier: "a", content })], "webhook");

    expect(hit?.excerpt).toContain("a bold webhook and a link here");
    expect(hit?.excerpt).not.toContain("**");
    expect(hit?.excerpt).not.toContain("https://example.com");
  });

  it("reads across a heading and a table without their markup", () => {
    const content = `${"filler ".repeat(40)}## Kind 7033 the webhook post\n\n| Tag | Description |\n|-----|-----|\n| p | the author |${"filler ".repeat(40)}`;
    const [hit] = searchDocs([doc({ identifier: "a", content })], "webhook");

    expect(hit?.excerpt).toContain("Kind 7033 the webhook post");
    expect(hit?.excerpt).not.toContain("#");
    expect(hit?.excerpt).not.toContain("|");
    expect(hit?.excerpt).toContain("Tag Description");
  });

  it("drops the half of a table rule the window was cut on", () => {
    const content = `${"filler ".repeat(30)}the webhook table | Tag | Description |\n|-----`;
    const [hit] = searchDocs([doc({ identifier: "a", content })], "webhook");

    expect(hit?.excerpt).toMatch(/Tag Description$/);
  });

  it("keeps the markup when stripping it would swallow the word", () => {
    const content = `${"filler ".repeat(40)}see [the docs](https://webhooks.example.com) for more${"filler ".repeat(40)}`;
    const [hit] = searchDocs([doc({ identifier: "a", content })], "webhooks");

    expect(hit?.excerpt).toContain("webhooks.example.com");
  });

  it("leaves the excerpt empty when the word is only in the metadata", () => {
    const [hit] = searchDocs(
      [doc({ identifier: "a", title: "Relay", content: "Nothing." })],
      "relay",
    );
    expect(hit?.excerpt).toBe("");
  });

  it("keeps the count it was given", () => {
    const docs = Array.from({ length: 10 }, (_, index) =>
      doc({ identifier: `d${index}`, title: "Relay" }),
    );
    expect(searchDocs(docs, "relay", 3)).toHaveLength(3);
  });
});
