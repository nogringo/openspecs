import type { MarkdownHeading } from "@openspecs/markdown";
import { renderMarkdown } from "@openspecs/markdown";
import { type Spec, type SpecKindRef, toNaddr, toNpub } from "@openspecs/nostr";

export type SpecPage = {
  kind: number;
  title: string;
  summary: string;
  summaryIsDerived: boolean;
  pubkey: string;
  npub: string;
  identifier: string;
  naddr: string;
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
 * Everything a document page draws, built from the event it was signed as.
 *
 * Here rather than beside the loader that usually calls it, because the browser
 * calls it too: a page served from a cache holds the revision that was live when
 * it was filled, and the reader's own copy of this function is what lets a newer
 * one replace it. Two functions would drift, and a document that read one way on
 * arrival and another a second later is worse than a stale one.
 *
 * The Markdown is rendered here rather than in the component, so a cache holds
 * the finished HTML and the parse runs once per revision instead of once per
 * request. The raw document is left behind: sending both would double the
 * payload of every page for no reader.
 */
export const toPage = (spec: Spec): SpecPage => {
  const { html, headings, links } = renderMarkdown(spec.content, { title: spec.title });
  return {
    kind: spec.event.kind,
    title: spec.title,
    summary: spec.summary,
    summaryIsDerived: spec.summaryIsDerived,
    pubkey: spec.pubkey,
    npub: toNpub(spec.pubkey),
    identifier: spec.identifier,
    naddr: toNaddr(spec),
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

/**
 * Whether a revision read from the relays should replace the one on screen.
 *
 * Only ever forward. Relays keep serving superseded revisions, so a page that
 * took whatever answered last would flicker between two of them, and one slow
 * relay holding last week's copy could walk a reader backwards. The tie is
 * broken on the lowest id, as NIP-01 asks and as `latestByCoordinate` does, so
 * this and the loader agree on which revision is the live one.
 */
export const isNewerRevision = (candidate: Spec, shown: SpecPage): boolean =>
  candidate.pubkey === shown.pubkey &&
  candidate.identifier === shown.identifier &&
  candidate.event.id !== shown.eventId &&
  (candidate.createdAt > shown.revisedAt ||
    (candidate.createdAt === shown.revisedAt && candidate.event.id < shown.eventId));
