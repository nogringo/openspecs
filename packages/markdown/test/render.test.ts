import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/index";

const html = (content: string, options?: Parameters<typeof renderMarkdown>[1]) =>
  renderMarkdown(content, options).html;

describe("sanitization", () => {
  it("drops scripts and event handlers", () => {
    const out = html('<script>alert(1)</script>\n\n<div onclick="alert(1)">hi</div>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onclick");
  });

  it("drops an href with a scripting protocol, keeping the text", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).toContain("<a>click</a>");
  });

  it("drops an image whose source is a scripting protocol", () => {
    expect(html("![x](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("does not let raw html through, even wrapped in markdown", () => {
    const out = html('> <iframe src="https://evil.example"></iframe>\n\n<style>*{}</style>');
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<style");
  });
});

describe("headings", () => {
  it("shifts every heading down one level, so the page keeps a single h1", () => {
    const out = html("# Title\n\n## Section\n\n### Detail");
    expect(out).toContain('<h2 id="title">Title</h2>');
    expect(out).toContain('<h3 id="section">Section</h3>');
    expect(out).toContain('<h4 id="detail">Detail</h4>');
  });

  it("keeps the levels as written once the repeated title is dropped", () => {
    const out = html("# NIP-XX\n\n## Motivation", { title: "NIP-XX" });
    expect(out).not.toContain("NIP-XX");
    expect(out).toContain('<h2 id="motivation">Motivation</h2>');
  });

  it("keeps a leading heading that is not the title", () => {
    const out = html("# Abstract\n\nBody.", { title: "NIP-XX" });
    expect(out).toContain('<h2 id="abstract">Abstract</h2>');
  });

  it("only drops the repeated title when it opens the document", () => {
    const out = html("Preamble.\n\n# NIP-XX\n\nBody.", { title: "NIP-XX" });
    expect(out).toContain("NIP-XX");
  });

  it("never shifts past h6", () => {
    expect(html("###### Deep")).toContain('<h6 id="deep">Deep</h6>');
  });

  it("honours an explicit offset", () => {
    expect(html("## Section", { headingOffset: 0 })).toContain("<h2");
  });

  it("reports headings with the identifiers rendered, disambiguating duplicates", () => {
    const { headings } = renderMarkdown("## Motivation\n\n### Motivation", { headingOffset: 0 });
    expect(headings).toEqual([
      { id: "motivation", depth: 2, text: "Motivation" },
      { id: "motivation-1", depth: 3, text: "Motivation" },
    ]);
  });

  it("leaves the generated footnote label out of the headings", () => {
    const { headings } = renderMarkdown("Text[^1].\n\n[^1]: Note.");
    expect(headings).toEqual([]);
  });
});

describe("gfm", () => {
  it("renders tables, task lists and strikethrough", () => {
    const out = html("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~");
    expect(out).toContain("<table>");
    expect(out).toContain('<input type="checkbox" checked disabled>');
    expect(out).toContain("<del>gone</del>");
  });

  it("links footnotes to identifiers that exist in the document", () => {
    const out = html("Text[^1].\n\n[^1]: Note.");
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('id="fn-1"');
    expect(out).not.toContain("user-content-");
  });

  it("keeps the language of a fenced block, for highlighting later", () => {
    expect(html("```js\nconsole.log(1)\n```")).toContain('<code class="language-js">');
  });
});

describe("links and images", () => {
  it("marks outgoing links as untrusted", () => {
    expect(html("[x](https://example.com)")).toContain(
      '<a href="https://example.com" rel="nofollow noopener noreferrer">x</a>',
    );
  });

  it("leaves in-document anchors alone", () => {
    expect(html("[x](#motivation)")).toContain('<a href="#motivation">x</a>');
  });

  it("defers images", () => {
    expect(html("![alt](https://example.com/a.png)")).toContain(
      '<img src="https://example.com/a.png" alt="alt" loading="lazy" decoding="async">',
    );
  });
});

describe("cited links", () => {
  it("reports the addresses a reader could follow, in reading order", () => {
    const { links } = renderMarkdown("[b](https://b.example) then [a](http://a.example/x)");
    expect(links).toEqual(["https://b.example", "http://a.example/x"]);
  });

  it("counts one address once, however often it is cited", () => {
    const { links } = renderMarkdown("[a](https://a.example) [again](https://a.example)");
    expect(links).toEqual(["https://a.example"]);
  });

  it("leaves out what points nowhere outside the document", () => {
    const { links } = renderMarkdown(
      "[anchor](#motivation) [mail](mailto:a@b.example) [bad](javascript:alert(1))\n\nText[^1].\n\n[^1]: Note.",
    );
    expect(links).toEqual([]);
  });
});

it("renders an empty document to nothing", () => {
  expect(renderMarkdown("")).toEqual({ html: "", headings: [], links: [] });
});
