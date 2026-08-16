import { describe, expect, it } from "vitest";
import { atomXml, type FeedItem, type FeedMeta, rssXml } from "./feed";

const meta: FeedMeta = {
  title: "Open Specs",
  description: "Signed specifications",
  home: "https://openspecs.org/",
  self: "https://openspecs.org/rss.xml?topic=a&kind=1",
};

const item = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  title: "NIPs on Nostr",
  link: "https://openspecs.org/spec/npub1abc/nips-on-nostr",
  summary: "A specification",
  publishedAt: 1781456610,
  revisedAt: 1781456610,
  author: "npub1abc",
  ...overrides,
});

describe("rssXml", () => {
  it("dates items the way RSS asks", () => {
    expect(rssXml(meta, [item()])).toContain("<pubDate>Sun, 14 Jun 2026 17:03:30 GMT</pubDate>");
  });

  it("identifies an item by its address, which survives a revision", () => {
    const xml = rssXml(meta, [item()]);
    expect(xml).toContain(
      '<guid isPermaLink="true">https://openspecs.org/spec/npub1abc/nips-on-nostr</guid>',
    );
  });

  it("escapes the ampersand of its own address", () => {
    expect(rssXml(meta, [])).toContain("rss.xml?topic=a&amp;kind=1");
    expect(rssXml(meta, [])).not.toMatch(/&(?!amp;|quot;|apos;|lt;|gt;)/);
  });

  it("escapes what an author wrote in a title", () => {
    const xml = rssXml(meta, [item({ title: "Tags & <script>" })]);
    expect(xml).toContain("<title>Tags &amp; &lt;script&gt;</title>");
    expect(xml).not.toContain("<script>");
  });

  it("stands as a document with nothing to publish", () => {
    const xml = rssXml(meta, []);
    expect(xml).toContain("</channel>");
    expect(xml).not.toContain("<lastBuildDate>");
  });
});

describe("atomXml", () => {
  it("dates entries the way Atom asks, publication apart from revision", () => {
    const xml = atomXml(meta, [item({ revisedAt: 1781543010 })]);
    expect(xml).toContain("<published>2026-06-14T17:03:30.000Z</published>");
    expect(xml).toContain("<updated>2026-06-15T17:03:30.000Z</updated>");
  });

  it("takes the newest revision as the date of the feed itself", () => {
    const xml = atomXml(meta, [item(), item({ revisedAt: 1781543010 })]);
    expect(xml).toContain("<updated>2026-06-15T17:03:30.000Z</updated>");
  });

  it("names the author, which is all this site knows of them", () => {
    expect(atomXml(meta, [item()])).toContain("<author><name>npub1abc</name></author>");
  });

  it("stands as a document with nothing to publish", () => {
    expect(atomXml(meta, [])).toContain("</feed>");
  });
});
