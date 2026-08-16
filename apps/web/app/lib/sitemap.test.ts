import { describe, expect, it } from "vitest";
import { sitemapXml } from "./sitemap";

describe("sitemapXml", () => {
  it("writes one url per entry", () => {
    const xml = sitemapXml([{ loc: "https://openspecs.org/" }, { loc: "https://openspecs.org/x" }]);
    expect(xml).toContain("<loc>https://openspecs.org/</loc>");
    expect(xml).toContain("<loc>https://openspecs.org/x</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });

  it("escapes the ampersand of a filtered listing, which would break the document", () => {
    const xml = sitemapXml([{ loc: "https://openspecs.org/specs?topic=a&kind=1" }]);
    expect(xml).toContain("<loc>https://openspecs.org/specs?topic=a&amp;kind=1</loc>");
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it("writes the revision date as an instant, not as a Nostr timestamp", () => {
    expect(sitemapXml([{ loc: "https://openspecs.org/x", lastmod: 1781456610 }])).toContain(
      "<lastmod>2026-06-14T17:03:30.000Z</lastmod>",
    );
  });

  it("leaves out a date it does not have", () => {
    expect(sitemapXml([{ loc: "https://openspecs.org/" }])).not.toContain("<lastmod>");
  });

  it("stays a valid document with nothing to list", () => {
    const xml = sitemapXml([]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("</urlset>");
  });
});
