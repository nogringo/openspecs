import type { MarkdownHeading } from "@openspecs/markdown";
import { renderMarkdown } from "@openspecs/markdown";
import {
  fetchSpec,
  fetchSpecs,
  type Spec,
  type SpecKindRef,
  specPath,
  toNpub,
} from "@openspecs/nostr";
import { createLoadCache } from "./cache.server";

/**
 * How long a document is served without asking the relays again. Short, because
 * a revision replaces its predecessor the moment its author publishes it, and
 * nothing tells this server when that happens.
 */
const FRESH_MS = 60_000;
/** A document that does not exist yet may appear at any time, so a miss expires sooner. */
const MISSING_MS = 10_000;

export type SpecPage = {
  kind: number;
  title: string;
  summary: string;
  summaryIsDerived: boolean;
  pubkey: string;
  npub: string;
  identifier: string;
  eventId: string;
  status: string | null;
  topics: string[];
  kinds: SpecKindRef[];
  publishedAt: number;
  revisedAt: number;
  isEmpty: boolean;
  html: string;
  headings: MarkdownHeading[];
  links: string[];
};

/**
 * The Markdown is rendered here rather than in the component, so the cache
 * holds the finished HTML and the parse runs once per revision instead of once
 * per request. The raw document is left behind: sending both would double the
 * payload of every page for no reader.
 */
const toPage = (spec: Spec): SpecPage => {
  const { html, headings, links } = renderMarkdown(spec.content, { title: spec.title });
  return {
    kind: spec.event.kind,
    title: spec.title,
    summary: spec.summary,
    summaryIsDerived: spec.summaryIsDerived,
    pubkey: spec.pubkey,
    npub: toNpub(spec.pubkey),
    identifier: spec.identifier,
    eventId: spec.event.id,
    status: spec.status,
    topics: spec.topics,
    kinds: spec.kinds,
    publishedAt: spec.publishedAt,
    revisedAt: spec.createdAt,
    isEmpty: spec.isEmpty,
    html,
    headings,
    links,
  };
};

const cache = createLoadCache<SpecPage | null>({
  max: 500,
  ttlMs: FRESH_MS,
  ttlMsFor: (page) => (page === null ? MISSING_MS : FRESH_MS),
});

export const loadSpec = (pubkey: string, identifier: string): Promise<SpecPage | null> =>
  cache.get(`${pubkey}:${identifier}`, async () => {
    const spec = await fetchSpec({ pubkey, identifier });
    return spec === null ? null : toPage(spec);
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
};

const listings = createLoadCache<SpecCard[]>({ max: 50, ttlMs: FRESH_MS });

/**
 * A blank document parses, because its author may simply not have written it
 * yet, but nothing worth reading is behind it. Listings are where that line is
 * drawn, so twice the documents are asked for and the empty ones dropped,
 * rather than returning a short page of placeholders.
 */
export const loadSpecs = (filter: SpecFilter = {}, limit = 30): Promise<SpecCard[]> =>
  listings.get(`${limit}:${filter.topic ?? ""}:${filter.kind ?? ""}`, async () => {
    const specs = await fetchSpecs({
      limit: limit * 2,
      ...(filter.topic ? { topics: [filter.topic] } : {}),
      ...(filter.kind === undefined ? {} : { covers: [filter.kind] }),
    });
    return specs
      .filter((spec) => !spec.isEmpty)
      .slice(0, limit)
      .map(toCard);
  });
