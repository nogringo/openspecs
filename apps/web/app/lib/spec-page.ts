import type { MarkdownHeading } from "@openspecs/markdown";
import { renderMarkdown } from "@openspecs/markdown";
import {
  parseCoordinate,
  type Spec,
  type SpecKindRef,
  specPath,
  toNaddr,
  toNpub,
} from "@openspecs/nostr";
import { mentionResolver } from "./mention";

/** One place a document says it was forked from, reduced to what the row drawing it needs. */
export type ForkSource =
  | { type: "spec"; npub: string; identifier: string; path: string }
  | { type: "external"; url: string; host: string };

/**
 * Where a document says it came from, named by its address and never fetched.
 * Reading the origin before this page could render would make the origin's
 * availability a condition of the fork's page, which is the accelerator rule
 * turned inside out. The address is what the tag actually says, and the link
 * goes where the title is.
 *
 * A list, because a document may honestly say it came from two places. In
 * practice there is one.
 */
const forkSourcesOf = (spec: Spec): ForkSource[] => {
  const sources: ForkSource[] = [];
  for (const fork of spec.forks) {
    if (fork.type === "external") {
      try {
        const url = new URL(fork.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        sources.push({ type: "external", url: fork.url, host: url.host.replace(/^www\./, "") });
      } catch {
        // A document is not worth less for carrying an address nobody can open.
      }
      continue;
    }
    const pointer = parseCoordinate(fork.coordinate);
    if (pointer === null) continue;
    // A marker naming the document it sits on draws a link back to the page you
    // are already reading, so it says nothing worth a row.
    if (pointer.pubkey === spec.pubkey && pointer.identifier === spec.identifier) continue;
    sources.push({
      type: "spec",
      npub: toNpub(pointer.pubkey),
      identifier: pointer.identifier,
      path: specPath(pointer),
    });
  }
  return sources;
};

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
  /** Named for where it points: `forks` here would read as the documents that forked this one. */
  forkedFrom: ForkSource[];
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
  const { html, headings, links } = renderMarkdown(spec.content, {
    title: spec.title,
    // Without names: a body is rendered here on the server and again in the
    // browser, and neither has profiles to hand. A key still becomes a link,
    // wearing the short form of itself, and a document becomes its address.
    mention: mentionResolver({}),
  });
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
    forkedFrom: forkSourcesOf(spec),
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
