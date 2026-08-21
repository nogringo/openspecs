import { escapeXml } from "./xml";

export type SitemapEntry = {
  loc: string;
  /** Seconds since the epoch, as Nostr counts them. */
  lastmod?: number;
};

/**
 * An author's page is only as fresh as their newest document, since that is
 * everything on it that this server can see change.
 */
export const newestByAuthor = (
  specs: { pubkey: string; revisedAt: number }[],
): Map<string, number> => {
  const newest = new Map<string, number>();
  for (const spec of specs) {
    newest.set(spec.pubkey, Math.max(newest.get(spec.pubkey) ?? 0, spec.revisedAt));
  }
  return newest;
};

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
