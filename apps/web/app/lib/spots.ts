import {
  type BlockAnchor,
  blockAnchors,
  compareMarkdown,
  KINSHIP_FLOOR,
  type MarkdownChange,
} from "@openspecs/markdown";
import { type Spec, toNpub } from "@openspecs/nostr";
import { mentionResolver } from "./mention";
import { diffPath } from "./paths";

export type SpotEntry = {
  pubkey: string;
  npub: string;
  /** The change as the comparison renders it, sanitized by the same pipeline as the page. */
  html: string;
  /** The whole comparison, read from this document's side. */
  diffHref: string;
};

/**
 * One key may hold two copies of a document, one at this name and one it renamed,
 * so a standing is filed under both halves of the address rather than the key.
 */
export const standingKey = (of: { pubkey: string; identifier: string }): string =>
  `${of.pubkey}:${of.identifier}`;

/** One place in the document where other keys' copies differ, however many do. */
export type Spot = {
  /**
   * Which of the page's rendered top level elements the marker sits at, `-1`
   * for changes before everything. The panel always unfolds below the element:
   * whether the passage reads differently there or new blocks follow it, below
   * is where the reader's eye goes next.
   */
  element: number;
  entries: SpotEntry[];
};

/**
 * A change anchored on source blocks, placed among the page's elements. The
 * page renders fewer elements than the source has blocks, so the position is
 * the count of rendered blocks before the anchor. A change to a block the page
 * draws nothing for marks nothing: there is no place to put it.
 */
const placeOf = (anchors: BlockAnchor[], change: MarkdownChange): number | null => {
  const renderedBefore = (index: number) =>
    anchors.slice(0, index).filter((anchor) => anchor.rendered).length;

  if (change.placement === "after") {
    return change.anchor < 0 ? -1 : renderedBefore(change.anchor + 1) - 1;
  }
  const anchor = anchors[change.anchor];
  if (anchor === undefined || !anchor.rendered) return null;
  return renderedBefore(change.anchor);
};

export type SpotBase = {
  content: string;
  title: string;
  npub: string;
  identifier: string;
};

/** Where a copy stands against this document, said in one short phrase on its card. */
export type Standing = { kind: "kin"; places: number } | { kind: "same" } | { kind: "independent" };

export type CopiesComparison = {
  spots: Spot[];
  /** By `standingKey`. A copy whose comparison never ran has no standing. */
  standings: Record<string, Standing>;
};

/**
 * Every place where another key's copy departs from this document, grouped by
 * the element it concerns so five copies touching one paragraph make one mark,
 * and each copy's standing alongside. A copy below the kinship floor annotates
 * nothing: it would mark every paragraph, and its card says it is its own
 * writing instead.
 */
export const compareCopies = (base: SpotBase, others: Spec[]): CopiesComparison => {
  const anchors = blockAnchors(base.content, base.title);
  const spots = new Map<number, Spot>();
  const standings: Record<string, Standing> = {};

  for (const other of others) {
    const comparison = compareMarkdown(base.content, other.content, {
      mention: mentionResolver({}),
    });
    const key = standingKey(other);
    if (comparison.similarity < KINSHIP_FLOOR) {
      standings[key] = { kind: "independent" };
      continue;
    }
    standings[key] =
      comparison.changes.length === 0
        ? { kind: "same" }
        : { kind: "kin", places: comparison.changes.length };

    const npub = toNpub(other.pubkey);
    for (const change of comparison.changes) {
      const element = placeOf(anchors, change);
      if (element === null) continue;
      const spot = spots.get(element) ?? { element, entries: [] };
      spot.entries.push({
        pubkey: other.pubkey,
        npub,
        html: change.html,
        diffHref: diffPath(base.npub, base.identifier, npub, other.identifier),
      });
      spots.set(element, spot);
    }
  }
  return { spots: [...spots.values()].sort((a, b) => a.element - b.element), standings };
};
