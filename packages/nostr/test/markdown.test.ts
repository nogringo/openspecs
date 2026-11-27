import { describe, expect, it } from "vitest";
import { deriveSummary, firstHeading, proseText, stripInlineMarkdown } from "../src/markdown";

describe("stripInlineMarkdown", () => {
  it("keeps link text and drops the target", () => {
    expect(stripInlineMarkdown("see [the spec](https://example.org)")).toBe("see the spec");
  });

  it("drops images entirely", () => {
    expect(stripInlineMarkdown("![badge](https://img.example/b.svg) real text")).toBe("real text");
  });

  it("unwraps emphasis and code", () => {
    expect(stripInlineMarkdown("**bold** _italic_ `code` ~~gone~~")).toBe("bold italic code gone");
  });

  it("keeps the underscores inside a word", () => {
    expect(stripInlineMarkdown("`created_at` and created_at, then __strong__ text")).toBe(
      "created_at and created_at, then strong text",
    );
  });
});

describe("firstHeading", () => {
  it("reads an ATX heading", () => {
    expect(firstHeading("# Custom Event Kind\n\nbody")).toBe("Custom Event Kind");
  });

  it("reads a setext heading", () => {
    expect(firstHeading("Custom Event Kind\n=================\n\nbody")).toBe("Custom Event Kind");
  });

  it("ignores a heading inside a fenced block", () => {
    expect(firstHeading("```\n# not a heading\n```\n\n# Real One")).toBe("Real One");
  });

  it("returns null when there is none", () => {
    expect(firstHeading("just a paragraph")).toBeNull();
  });
});

describe("deriveSummary", () => {
  it("skips the title heading and takes the first paragraph", () => {
    expect(deriveSummary("# Title\n\nThe abstract goes here.\n\nMore later.")).toBe(
      "The abstract goes here.",
    );
  });

  it("skips a badge row", () => {
    const md = "# Title\n\n![a](https://x/a.svg) ![b](https://x/b.svg)\n\nThe real abstract.";
    expect(deriveSummary(md)).toBe("The real abstract.");
  });

  it("skips a setext heading and its underline", () => {
    expect(deriveSummary("NIPs on Nostr\n=============\n\nThe abstract.")).toBe("The abstract.");
    expect(deriveSummary("Title\n-----\n\nThe abstract.")).toBe("The abstract.");
  });

  it("skips a status line made of code spans", () => {
    expect(deriveSummary("NIP-72\n======\n\n`draft` `optional`\n\nThe abstract.")).toBe(
      "The abstract.",
    );
  });

  it("skips front matter", () => {
    expect(deriveSummary("---\ntitle: x\n---\n\nThe abstract.")).toBe("The abstract.");
  });

  it("skips a fenced block that opens the document", () => {
    expect(deriveSummary("```json\n{ }\n```\n\nThe abstract.")).toBe("The abstract.");
  });

  it("joins a wrapped paragraph into one line", () => {
    expect(deriveSummary("first line\nsecond line")).toBe("first line second line");
  });

  it("truncates on a word boundary", () => {
    const summary = deriveSummary(`${"word ".repeat(80)}end`, 60);
    expect(summary.length).toBeLessThanOrEqual(63);
    expect(summary.endsWith("...")).toBe(true);
    expect(summary).not.toContain("wor...");
  });

  it("returns an empty string when there is no prose at all", () => {
    expect(deriveSummary("")).toBe("");
    expect(deriveSummary("# Only a heading")).toBe("");
  });
});

describe("proseText", () => {
  it("keeps running text and drops headings, code, tables and status lines", () => {
    const content = [
      "NIP-17",
      "======",
      "",
      "Private Direct Messages",
      "-----------------------",
      "",
      "`draft` `optional` `relay`",
      "",
      "This NIP uses [NIP-44](nostr:naddr1qvzqqqrcvypzq2) encryption.",
      "## Kinds",
      "A **kind 14** is a chat message.",
      "",
      "```json",
      '{ "kind": 14 }',
      "```",
      "",
      "| kind | name |",
      "| --- | --- |",
      "| 14 | DM |",
      "",
      "- one item",
      "- another",
    ].join("\n");

    expect(proseText(content)).toBe(
      "This NIP uses NIP-44 encryption. A kind 14 is a chat message. one item another",
    );
  });
});
