import { authorPath, parsePubkey } from "@openspecs/nostr";
import { data } from "react-router";
import { atomXml, type FeedItem, type FeedMeta, rssXml } from "./feed";
import { parseSpecFilter } from "./filter";
import { NOT_FOUND_HEADERS } from "./http";
import { publicOrigin } from "./origin.server";
import {
  atomPath,
  authorAtomPath,
  authorRssPath,
  feedTitle,
  listingDescription,
  rssPath,
  specsPath,
} from "./paths";
import { authorDescription, authorName } from "./profile";
import { loadAuthor } from "./profile.server";
import { loadAuthorSpecs, loadSpecs, type SpecCard } from "./specs.server";

const ITEMS = 30;

const FORMATS = {
  rss: { path: rssPath, render: rssXml, type: "application/rss+xml" },
  atom: { path: atomPath, render: atomXml, type: "application/atom+xml" },
} as const;

export type FeedFormat = keyof typeof FORMATS;

const feed = (format: FeedFormat, meta: FeedMeta, specs: SpecCard[], origin: string): Response => {
  const { render, type } = FORMATS[format];
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

/**
 * Both formats carry the same documents under the same filters as the listing,
 * so a reader can subscribe to exactly the page they are looking at.
 */
export const feedResponse = async (request: Request, format: FeedFormat): Promise<Response> => {
  const filter = parseSpecFilter(new URL(request.url).searchParams);
  const origin = publicOrigin(request);
  const specs = await loadSpecs(filter, ITEMS).catch(() => []);

  return feed(
    format,
    {
      title: feedTitle(filter),
      description: listingDescription(filter),
      home: `${origin}${specsPath(filter)}`,
      self: `${origin}${FORMATS[format].path(filter)}`,
    },
    specs,
    origin,
  );
};

/**
 * Only the canonical npub serves a feed. The page redirects every other way of
 * naming an author, and a reader subscribes to the address it hands them.
 */
export const authorFeedResponse = async (
  request: Request,
  npub: string,
  format: FeedFormat,
): Promise<Response> => {
  const pubkey = npub.startsWith("npub1") ? parsePubkey(npub) : null;
  if (pubkey === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  const origin = publicOrigin(request);
  const [author, specs] = await Promise.all([loadAuthor(pubkey), loadAuthorSpecs(pubkey)]);
  // The same rule the page follows: a key with nothing behind it is not an
  // author here, so it is not something to subscribe to either.
  if (author === null && specs.length === 0) {
    throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const name = authorName(author, npub);
  const self = format === "rss" ? authorRssPath(npub) : authorAtomPath(npub);

  return feed(
    format,
    {
      title: `Open Specs, ${name}`,
      description: authorDescription(author, npub, specs.length),
      home: `${origin}${authorPath(pubkey)}`,
      self: `${origin}${self}`,
    },
    specs.slice(0, ITEMS),
    origin,
  );
};
