import { describe, expect, it } from "vitest";
import { diffMarkdown, textSimilarity } from "../src/index";

describe("textSimilarity", () => {
  it("gives identical texts one", () => {
    expect(textSimilarity("a b c", "a b c")).toBe(1);
  });

  it("gives disjoint texts zero", () => {
    expect(textSimilarity("a b c", "x y z")).toBe(0);
  });

  it("gives two empty texts one", () => {
    expect(textSimilarity("", "  ")).toBe(1);
  });
});

describe("diffMarkdown", () => {
  it("reports identical documents unchanged, with no marks", () => {
    const doc = "# Title\n\nSome text.\n\n```js\ncode()\n```";
    const diff = diffMarkdown(doc, doc);
    expect(diff.changed).toBe(false);
    expect(diff.similarity).toBe(1);
    expect(diff.html).not.toContain("<ins>");
    expect(diff.html).not.toContain("<del>");
  });

  it("treats whitespace-only differences as no change", () => {
    expect(diffMarkdown("one  two\nthree", "one two three").changed).toBe(false);
  });

  it("marks words inserted inside a code line, keeping the block one block", () => {
    // The NIP-07 case: `pubkey?: string,` added in the middle of a signature.
    const base = "```ts\nsignEvent(event: { created_at: number, kind: number }): Event\n```";
    const other =
      "```ts\nsignEvent(event: { pubkey?: string, created_at: number, kind: number }): Event\n```";
    const { html } = diffMarkdown(base, other);
    expect(html).toContain("<ins>pubkey?: string, </ins>");
    expect(html).not.toContain("<del>");
    expect(html.match(/<pre/g)).toHaveLength(1);
  });

  it("wraps a section the other document adds, whole", () => {
    // The NIP-09 case: a Tag Reference section that exists in one version only.
    const base = "## Usage\n\nText.";
    const other = "## Usage\n\nText.\n\n## Tag Reference\n\nThe `e` tag deletes by id.";
    const { html, changed } = diffMarkdown(base, other);
    expect(changed).toBe(true);
    expect(html).toContain('<div class="diff-ins"><h2');
    expect(html).not.toContain("<del>");
  });

  it("shows a symmetric divergence with both marks", () => {
    // The NIP-59 case: each branch holds a passage the other lacks.
    const base = "Shared opening.\n\n## Spam Protection\n\nRelays may require auth.";
    const other = "Shared opening.\n\nThe optional self tag SHOULD be included.";
    const { html } = diffMarkdown(base, other);
    expect(html).toContain('class="diff-del"');
    expect(html).toContain('class="diff-ins"');
  });

  it("marks a reworked sentence in place, inside one paragraph", () => {
    const base = "Relays SHOULD delete all versions of the replaceable event.";
    const other = "Relays SHOULD delete all events matching the kind and pubkey.";
    const { html } = diffMarkdown(base, other);
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html).toContain("<del>");
    expect(html).toContain("<ins>");
    expect(html).toContain("Relays SHOULD delete all");
  });

  it("keeps a table one table when the other version adds a row", () => {
    // The trusted-assertions case: one row added to a shared table.
    const row = (name: string, tag: string) => `| ${name} | ${tag} |`;
    const table = (rows: string[]) => ["| Name | Tag |", "| --- | --- |", ...rows].join("\n");
    const base = table([row("First Post Time", "first_created_at")]);
    const other = table([
      row("First Post Time", "first_created_at"),
      row("First Seen Time", "first_seen_at"),
    ]);
    const { html } = diffMarkdown(base, other);
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain("<ins>First Seen Time</ins>");
    expect(html).not.toContain("<del>");
  });

  it("emits a changed heading once, under its new identifier", () => {
    const { html } = diffMarkdown("## Client\n\nText.", "## Client Usage\n\nText.");
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain('id="client-usage"');
    expect(html).toContain("<ins> Usage</ins>");
  });

  it("shows two passages whole when they share too little to merge", () => {
    const base = "The quick brown fox jumps over the lazy dog near the river bank.";
    const other = "Completely different words describing another idea entirely, twice as long.";
    const { html } = diffMarkdown(base, other);
    expect(html).toContain('class="diff-del"');
    expect(html).toContain('class="diff-ins"');
    expect(html).not.toContain("<ins>");
  });

  it("keeps the sanitizer between authors and the page", () => {
    const { html } = diffMarkdown("safe text", "safe text <script>alert(1)</script> and more");
    expect(html).not.toContain("<script");
  });

  it("keeps heading depths level between a titled and an untitled document", () => {
    const base = "# Doc\n\n## Section\n\nText.";
    const other = "## Section\n\nText.";
    const { html } = diffMarkdown(base, other);
    // Both copies of "Section" render at the same depth, so it does not read as
    // a change; only the title heading itself is struck.
    expect(html.match(/<h3 id="section"/g)).toHaveLength(1);
    expect(html).toContain('<div class="diff-del"><h2 id="doc"');
    expect(html).not.toContain("<ins>");
  });
});
