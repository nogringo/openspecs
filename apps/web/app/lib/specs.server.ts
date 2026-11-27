import { highlighter } from "@openspecs/markdown";
import type { NostrEvent } from "@openspecs/nostr";
import {
  fetchSpec,
  fetchSpecs,
  latestByCoordinate,
  type Spec,
  type SpecKindRef,
  specPath,
  toNpub,
} from "@openspecs/nostr";
import { createLoadCache } from "./cache.server";
import { corpus, hasTag } from "./corpus.server";
import { type SpecPage, toPage } from "./spec-page";

export type { SpecPage };

/**
 * How long a document is served without asking the relays again. Short, because
 * a revision replaces its predecessor the moment its author publishes it, and
 * nothing tells this server when that happens.
 */
export const FRESH_MS = 60_000;
/** A document that does not exist yet may appear at any time, so a miss expires sooner. */
const MISSING_MS = 10_000;
/**
 * How long an expired document is still served while the relays are asked again
 * behind it, so a reader never waits on them for a page this server has seen. A
 * day, like the `stale-while-revalidate` the pages declare, and the browser offers
 * the newer revision if there is one.
 */
export const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * The event travels with the page through the cache but never into a loader's
 * payload: the page needs the rendered document, and only the routes that serve
 * the event itself need its 15 kilobytes of JSON.
 */
export type CachedSpec = { page: SpecPage; event: NostrEvent };

const cache = createLoadCache<CachedSpec | null>({
  max: 500,
  ttlMs: FRESH_MS,
  ttlMsFor: (cached) => (cached === null ? MISSING_MS : FRESH_MS),
  staleMs: STALE_MS,
  // A miss is never served stale: the document may have just been published.
  staleMsFor: (cached) => (cached === null ? 0 : STALE_MS),
});

const render = (spec: Spec): CachedSpec => ({
  page: toPage(spec, { highlight: highlighter }),
  event: spec.event,
});

/**
 * A document the corpus holds is served from it, and the relays are asked behind
 * the reader, the author's own included. Whichever revision is newer wins, so a
 * relay that does not answer in time cannot turn a known document into a 404.
 */
export const loadSpec = (pubkey: string, identifier: string): Promise<CachedSpec | null> => {
  void corpus.start();
  const key = `${pubkey}:${identifier}`;
  const known = corpus.spec(pubkey, identifier);
  if (known !== undefined) cache.seed(key, () => render(known));
  return cache.get(key, async () => {
    const fetched = await fetchSpec({ pubkey, identifier });
    const held = corpus.spec(pubkey, identifier);
    const [spec] = latestByCoordinate([fetched, held].filter((one) => one != null));
    return spec === undefined ? null : render(spec);
  });
};

export type SpecCard = {
  path: string;
  title: string;
  summary: string;
  pubkey: string;
  npub: string;
  identifier: string;
  status: string | null;
  kinds: SpecKindRef[];
  topics: string[];
  publishedAt: number;
  revisedAt: number;
};

const toCard = (spec: Spec): SpecCard => ({
  path: specPath(spec),
  title: spec.title,
  summary: spec.summary,
  pubkey: spec.pubkey,
  npub: toNpub(spec.pubkey),
  identifier: spec.identifier,
  status: spec.status,
  kinds: spec.kinds,
  topics: spec.topics,
  publishedAt: spec.publishedAt,
  revisedAt: spec.createdAt,
});

export type SpecFilter = {
  /** A `t` tag, matched exactly as a relay matches it, whichever of the two answers. */
  topic?: string;
  /** A `k` tag: the event kind a document is about. */
  kind?: number;
  /** A hex key. Asking for one author's documents is also what turns the outbox on. */
  author?: string;
};

const listings = createLoadCache<SpecCard[]>({ max: 50, ttlMs: FRESH_MS, staleMs: STALE_MS });

/**
 * A blank document parses, because its author may simply not have written it
 * yet, but nothing worth reading is behind it. Listings are where that line is
 * drawn, rather than returning a short page of placeholders.
 */
const listingOf = (specs: Spec[], filter: SpecFilter, limit: number): SpecCard[] =>
  specs
    .filter(
      (spec) =>
        !spec.isEmpty &&
        (!filter.topic || hasTag(spec, "t", filter.topic)) &&
        (filter.kind === undefined || hasTag(spec, "k", String(filter.kind))) &&
        (!filter.author || spec.pubkey === filter.author),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(toCard);

/**
 * Read off the corpus once it has been walked, since it holds everything the
 * read relays would answer and more than a `limit` lets them. One author's shelf
 * is the exception: their own relays may hold what no read relay does, so the
 * corpus only answers until those have been asked.
 */
export const loadSpecs = (filter: SpecFilter = {}, limit = 30): Promise<SpecCard[]> => {
  void corpus.start();
  const known = corpus.specs();
  if (known !== undefined && !filter.author)
    return Promise.resolve(listingOf(known, filter, limit));

  const key = `${limit}:${filter.topic ?? ""}:${filter.kind ?? ""}:${filter.author ?? ""}`;
  if (known !== undefined) listings.seed(key, () => listingOf(known, filter, limit));
  return listings.get(key, async () => {
    // Twice what is shown, since the blank ones are dropped below.
    const specs = await fetchSpecs({
      limit: limit * 2,
      ...(filter.topic ? { topics: [filter.topic] } : {}),
      ...(filter.kind === undefined ? {} : { covers: [filter.kind] }),
      ...(filter.author ? { authors: [filter.author] } : {}),
    });
    return specs
      .filter((spec) => !spec.isEmpty)
      .slice(0, limit)
      .map(toCard);
  });
};

/**
 * How far down a listing can be paged. The window is fetched whole and cut into
 * pages here rather than walked with a relay cursor: an `until` is a `created_at`,
 * and a corpus mirrored from git carries whole commits' worth of documents on the
 * same second, which no cursor can step past.
 */
export const LISTING_WINDOW = 500;

/**
 * The whole shelf, unpaged: the page, its card and its feeds ask for the same
 * list under the same key, so an unfurled link costs one relay query rather than
 * three, and each of them counts what the key actually signed.
 */
export const loadAuthorSpecs = (pubkey: string): Promise<SpecCard[]> =>
  loadSpecs({ author: pubkey }, LISTING_WINDOW);
