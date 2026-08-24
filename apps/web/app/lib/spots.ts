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

/**
 * Every place where another key's copy departs from this document, grouped by
 * the element it concerns so five copies touching one paragraph make one mark.
 * A copy below the kinship floor annotates nothing: it would mark every
 * paragraph, and the "Under this name" section already says it exists.
 */
export const spotsOf = (base: SpotBase, others: Spec[]): Spot[] => {
  const anchors = blockAnchors(base.content, base.title);
  const spots = new Map<number, Spot>();

  for (const other of others) {
    const comparison = compareMarkdown(base.content, other.content, {
      mention: mentionResolver({}),
    });
    if (comparison.similarity < KINSHIP_FLOOR) continue;

    const npub = toNpub(other.pubkey);
    for (const change of comparison.changes) {
      const element = placeOf(anchors, change);
      if (element === null) continue;
      const spot = spots.get(element) ?? { element, entries: [] };
      spot.entries.push({
        pubkey: other.pubkey,
        npub,
        html: change.html,
        diffHref: diffPath(base.npub, base.identifier, npub),
      });
      spots.set(element, spot);
    }
  }
  return [...spots.values()].sort((a, b) => a.element - b.element);
};
