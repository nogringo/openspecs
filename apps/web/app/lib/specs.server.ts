import type { MarkdownHeading } from "@openspecs/markdown";
import { renderMarkdown } from "@openspecs/markdown";
import { fetchSpec, type Spec, type SpecKindRef, toNpub } from "@openspecs/nostr";
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
};

/**
 * The Markdown is rendered here rather than in the component, so the cache
 * holds the finished HTML and the parse runs once per revision instead of once
 * per request. The raw document is left behind: sending both would double the
 * payload of every page for no reader.
 */
const toPage = (spec: Spec): SpecPage => {
  const { html, headings } = renderMarkdown(spec.content, { title: spec.title });
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
