import { escapeXml } from "./xml";

export type FeedItem = {
  title: string;
  link: string;
  summary: string;
  /** Seconds since the epoch, as Nostr counts them. */
  publishedAt: number;
  revisedAt: number;
  author: string;
};

export type FeedMeta = {
  title: string;
  description: string;
  /** The page a reader lands on, and the address of the feed itself. */
  home: string;
  self: string;
};

const rfc822 = (seconds: number): string => new Date(seconds * 1000).toUTCString();
const rfc3339 = (seconds: number): string => new Date(seconds * 1000).toISOString();

const updatedAt = (items: FeedItem[]): number =>
  items.reduce((latest, item) => Math.max(latest, item.revisedAt), 0);

/**
 * The link is the identifier in both formats. A document keeps its address
 * across revisions, which is exactly what a reader needs to not see the same
 * document twice after its author fixes a typo.
 */
export const rssXml = (meta: FeedMeta, items: FeedItem[]): string => {
  const entries = items.map(
    (item) => `  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.link)}</link>
    <guid isPermaLink="true">${escapeXml(item.link)}</guid>
    <description>${escapeXml(item.summary)}</description>
    <pubDate>${rfc822(item.publishedAt)}</pubDate>
  </item>`,
  );

  const latest = updatedAt(items);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(meta.title)}</title>
  <link>${escapeXml(meta.home)}</link>
  <description>${escapeXml(meta.description)}</description>
  <atom:link href="${escapeXml(meta.self)}" rel="self" type="application/rss+xml"/>
${latest > 0 ? `  <lastBuildDate>${rfc822(latest)}</lastBuildDate>\n` : ""}${entries.join("\n")}
</channel>
</rss>
`;
};

export const atomXml = (meta: FeedMeta, items: FeedItem[]): string => {
  const entries = items.map(
    (item) => `  <entry>
    <title>${escapeXml(item.title)}</title>
    <link href="${escapeXml(item.link)}"/>
    <id>${escapeXml(item.link)}</id>
    <published>${rfc3339(item.publishedAt)}</published>
    <updated>${rfc3339(item.revisedAt)}</updated>
    <author><name>${escapeXml(item.author)}</name></author>
    <summary>${escapeXml(item.summary)}</summary>
  </entry>`,
  );

  const latest = updatedAt(items);
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(meta.title)}</title>
  <subtitle>${escapeXml(meta.description)}</subtitle>
  <link href="${escapeXml(meta.home)}"/>
  <link href="${escapeXml(meta.self)}" rel="self" type="application/atom+xml"/>
  <id>${escapeXml(meta.self)}</id>
  <updated>${rfc3339(latest > 0 ? latest : 0)}</updated>
${entries.join("\n")}
</feed>
`;
};
