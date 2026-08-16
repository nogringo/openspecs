export type SitemapEntry = {
  loc: string;
  /** Seconds since the epoch, as Nostr counts them. */
  lastmod?: number;
};

/** A listing URL carries a query string, and a bare `&` makes the document invalid XML. */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const sitemapXml = (entries: SitemapEntry[]): string => {
  const urls = entries.map((entry) => {
    const lastmod =
      entry.lastmod === undefined
        ? ""
        : `<lastmod>${new Date(entry.lastmod * 1000).toISOString()}</lastmod>`;
    return `<url><loc>${escapeXml(entry.loc)}</loc>${lastmod}</url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
};
