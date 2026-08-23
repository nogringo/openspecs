import { authorPath } from "@openspecs/nostr";
import { publicOrigin } from "~/lib/origin.server";
import { specsPath } from "~/lib/paths";
import { newestByAuthor, type SitemapEntry, sitemapXml } from "~/lib/sitemap";
import { LISTING_WINDOW, loadSpecs } from "~/lib/specs.server";
import { topicsByFrequency } from "~/lib/topics";
import type { Route } from "./+types/sitemap";

const TOPICS = 30;

/**
 * The same window the listing pages, so this reports exactly what a crawler can
 * reach and the two never disagree. Relays keep no index to page through, so the
 * window is still the ceiling: the whole corpus only becomes listable once the
 * indexer of lot 6 exists. Every document is named here in its own right, so the
 * numbered listing pages are left out rather than repeated as a second way in.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const origin = publicOrigin(request);
  const specs = await loadSpecs({}, LISTING_WINDOW).catch(() => []);
  const newest = specs.reduce((latest, spec) => Math.max(latest, spec.revisedAt), 0);

  const entries: SitemapEntry[] = [
    { loc: `${origin}/`, ...(newest > 0 && { lastmod: newest }) },
    { loc: `${origin}${specsPath()}`, ...(newest > 0 && { lastmod: newest }) },
    ...topicsByFrequency(specs, TOPICS).map((topic) => ({
      loc: `${origin}${specsPath({ topic })}`,
    })),
    ...[...newestByAuthor(specs)].map(([pubkey, lastmod]) => ({
      loc: `${origin}${authorPath(pubkey)}`,
      lastmod,
    })),
    ...specs.map((spec) => ({ loc: `${origin}${spec.path}`, lastmod: spec.revisedAt })),
  ];

  return new Response(sitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
