import type { NostrEvent } from "@openspecs/nostr";
import {
  fetchSpec,
  fetchSpecs,
  type Spec,
  type SpecKindRef,
  specPath,
  toNpub,
} from "@openspecs/nostr";
import { createLoadCache } from "./cache.server";
import { type SpecPage, toPage } from "./spec-page";

export type { SpecPage };

/**
 * How long a document is served without asking the relays again. Short, because
 * a revision replaces its predecessor the moment its author publishes it, and
 * nothing tells this server when that happens.
 */
const FRESH_MS = 60_000;
/** A document that does not exist yet may appear at any time, so a miss expires sooner. */
const MISSING_MS = 10_000;

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
});

export const loadSpec = (pubkey: string, identifier: string): Promise<CachedSpec | null> =>
  cache.get(`${pubkey}:${identifier}`, async () => {
    const spec = await fetchSpec({ pubkey, identifier });
    return spec === null ? null : { page: toPage(spec), event: spec.event };
  });

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
  /** A `t` tag, which relays index, so this is asked of them rather than filtered here. */
  topic?: string;
  /** A `k` tag: the event kind a document is about. */
  kind?: number;
  /** A hex key. Asking for one author's documents is also what turns the outbox on. */
  author?: string;
};

const listings = createLoadCache<SpecCard[]>({ max: 50, ttlMs: FRESH_MS });

/**
 * A blank document parses, because its author may simply not have written it
 * yet, but nothing worth reading is behind it. Listings are where that line is
 * drawn, so twice the documents are asked for and the empty ones dropped,
 * rather than returning a short page of placeholders.
 */
export const loadSpecs = (filter: SpecFilter = {}, limit = 30): Promise<SpecCard[]> =>
  listings.get(
    `${limit}:${filter.topic ?? ""}:${filter.kind ?? ""}:${filter.author ?? ""}`,
    async () => {
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
    },
  );

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
