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
    expect(out).toContain('<h2 id="title">Title<');
    expect(out).toContain('<h3 id="section">Section<');
    expect(out).toContain('<h4 id="detail">Detail<');
  });

  it("keeps the levels as written once the repeated title is dropped", () => {
    const out = html("# NIP-XX\n\n## Motivation", { title: "NIP-XX" });
    expect(out).not.toContain("NIP-XX");
    expect(out).toContain('<h2 id="motivation">Motivation<');
  });

  it("keeps a leading heading that is not the title", () => {
    const out = html("# Abstract\n\nBody.", { title: "NIP-XX" });
    expect(out).toContain('<h2 id="abstract">Abstract<');
  });

  it("only drops the repeated title when it opens the document", () => {
    const out = html("Preamble.\n\n# NIP-XX\n\nBody.", { title: "NIP-XX" });
    expect(out).toContain("NIP-XX");
  });

  it("never shifts past h6", () => {
    expect(html("###### Deep")).toContain('<h6 id="deep">Deep<');
  });

  it("gives every heading a permalink back to itself", () => {
    expect(html("## Section", { headingOffset: 0 })).toContain(
      '<h2 id="section">Section<a class="heading-anchor" aria-label="Link to Section" href="#section"><span aria-hidden="true">#</span></a></h2>',
    );
  });

  it("keeps the permalink sign out of the reported heading text", () => {
    const { headings } = renderMarkdown("## Section", { headingOffset: 0 });
    expect(headings).toEqual([{ id: "section", depth: 2, text: "Section" }]);
  });

  it("leaves the generated footnote label without a permalink", () => {
    const out = html("Text[^1].\n\n[^1]: Note.");
    expect(out).not.toContain("heading-anchor");
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

describe("mentions", () => {
  const NPUB = "npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sj9uvyq";
  const resolve = (mention: { label: string; href?: string; color?: string }) => () => mention;

  it("wears the colour the resolver gave it, so two same names are told apart", () => {
    const out = html(`Ask nostr:${NPUB} about it.`, {
      mention: resolve({ label: "@alice", href: "/a", color: "light-dark(#db4242, #f04a4a)" }),
    });
    expect(out).toContain('style="color:light-dark(#db4242, #f04a4a)"');
    expect(out).toContain("@alice");
  });

  it("stays plain when the resolver names no colour", () => {
    const out = html(`Ask nostr:${NPUB} about it.`, {
      mention: resolve({ label: "@alice", href: "/a" }),
    });
    expect(out).toContain("@alice");
    expect(out).not.toContain("style=");
  });
});

describe("references", () => {
  const NADDR =
    "naddr1qvzqqqrcvypzpzvm2zlskr58g4u4k3m54454y087r30hedgtavyn75q4yp55dm9lqqrxuat595ergwfsx56rgvfe";
  const point = (href?: string) => () => (href === undefined ? null : { label: "x", href });

  it("points a link written as a reference at wherever the resolver says", () => {
    const out = html(`see [BUD-01](nostr:${NADDR})`, { mention: point("/spec/npub1a/bud-01") });
    expect(out).toContain('<a href="/spec/npub1a/bud-01">BUD-01</a>');
  });

  it("keeps the fragment, so a link into a section still lands on it", () => {
    const out = html(`[get](nostr:${NADDR}#get-blob)`, { mention: point("/spec/npub1a/bud-01") });
    expect(out).toContain('href="/spec/npub1a/bud-01#get-blob"');
  });

  it("leaves the reference itself when nothing resolves it", () => {
    const out = html(`see [BUD-01](nostr:${NADDR})`, { mention: point() });
    expect(out).toContain(`href="nostr:${NADDR}"`);
  });

  it("keeps the reference when no resolver was given, rather than dropping it", () => {
    expect(html(`see [BUD-01](nostr:${NADDR})`)).toContain(`href="nostr:${NADDR}"`);
  });

  it("does not cite a reference as an outgoing link", () => {
    const { links } = renderMarkdown(`[one](nostr:${NADDR}) and [two](https://example.com)`, {
      mention: point("/spec/npub1a/bud-01"),
    });
    expect(links).toEqual(["https://example.com"]);
  });

  it("still drops a scripting protocol", () => {
    expect(html("[click](javascript:alert(1))")).toContain("<a>click</a>");
  });
});

it("renders an empty document to nothing", () => {
  expect(renderMarkdown("")).toEqual({ html: "", headings: [], links: [] });
});
