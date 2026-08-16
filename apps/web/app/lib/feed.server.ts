import { atomXml, type FeedItem, type FeedMeta, rssXml } from "./feed";
import { parseSpecFilter } from "./filter";
import { publicOrigin } from "./origin.server";
import { atomPath, feedTitle, listingDescription, rssPath, specsPath } from "./paths";
import { loadSpecs } from "./specs.server";

const ITEMS = 30;

const FORMATS = {
  rss: { path: rssPath, render: rssXml, type: "application/rss+xml" },
  atom: { path: atomPath, render: atomXml, type: "application/atom+xml" },
} as const;

/**
 * Both formats carry the same documents under the same filters as the listing,
 * so a reader can subscribe to exactly the page they are looking at.
 */
export const feedResponse = async (
  request: Request,
  format: keyof typeof FORMATS,
): Promise<Response> => {
  const { path, render, type } = FORMATS[format];
  const filter = parseSpecFilter(new URL(request.url).searchParams);
  const origin = publicOrigin(request);
  const specs = await loadSpecs(filter, ITEMS).catch(() => []);

  const meta: FeedMeta = {
    title: feedTitle(filter),
    description: listingDescription(filter),
    home: `${origin}${specsPath(filter)}`,
    self: `${origin}${path(filter)}`,
  };

  const items: FeedItem[] = specs.map((spec) => ({
    title: spec.title,
    link: `${origin}${spec.path}`,
    summary: spec.summary,
    publishedAt: spec.publishedAt,
    revisedAt: spec.revisedAt,
    author: spec.npub,
  }));

  return new Response(render(meta, items), {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
};
