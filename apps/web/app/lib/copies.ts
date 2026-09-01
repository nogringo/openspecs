import {
  fetchSpecs,
  latestByCoordinate,
  type NostrEvent,
  type Spec,
  specPath,
  toCoordinate,
  toNpub,
} from "@openspecs/nostr";
import { useEffect, useState } from "react";
import { eventPath } from "./paths";
import { compareCopies, type Spot, type Standing } from "./spots";

/** Another key's copy of this document, reduced to what its row draws. */
export type Copy = {
  pubkey: string;
  npub: string;
  identifier: string;
  title: string;
  summary: string;
  revisedAt: number;
  path: string;
  /** True where it sits at this document's address too, which is how it was found. */
  sameName: boolean;
};

/**
 * Every other document that is a copy of this one, found two ways and listed
 * once.
 *
 * A copy publishes at this address, or it says in an `a` tag that it started
 * here, or both. Which of the two found it is bookkeeping: what a reader wants
 * is the copy, and how it reads against this one, which the standing on its row
 * answers by looking at the text rather than by believing a tag.
 *
 * The document itself is dropped because it is the page, and blank ones the way
 * every listing drops them. Newest revision first, which is the order everything
 * else on this site lists in: any other order would be a ranking, and ranking
 * the versions of a document is the one call this site refuses to make.
 */
export const selectCopies = (
  specs: Spec[],
  shown: { pubkey: string; identifier: string },
): Copy[] => {
  const here = toCoordinate(shown);
  return specs
    .filter((spec) => {
      if (spec.isEmpty) return false;
      if (spec.pubkey === shown.pubkey && spec.identifier === shown.identifier) return false;
      if (spec.identifier === shown.identifier) return true;
      // Relays index an `a` tag's value and not the marker after it, so this is
      // where a fork is told apart from an `update`, an `extends`, or a page of
      // a documentation space.
      return spec.forks.some((fork) => fork.type === "spec" && fork.coordinate === here);
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((spec) => ({
      pubkey: spec.pubkey,
      npub: toNpub(spec.pubkey),
      identifier: spec.identifier,
      title: spec.title,
      summary: spec.summary,
      revisedAt: spec.createdAt,
      path: specPath(spec),
      sameName: spec.identifier === shown.identifier,
    }));
};

export type Copies = {
  copies: Copy[];
  /** The places in the shown revision where those copies differ, for the margin. */
  spots: Spot[];
  /** Each copy's standing against the shown revision, by `standingKey`. */
  standings: Record<string, Standing>;
};

const NOTHING: Copies = { copies: [], spots: [], standings: {} };

/**
 * The marks must sit on the text the reader is looking at, so the base source
 * has to be the shown revision exactly. The relays usually hand it back in the
 * same query that found the copies; when they hold another revision, the
 * server's own copy of the event is the one the page was rendered from.
 */
const baseContentOf = async (
  specs: Spec[],
  shown: { pubkey: string; npub: string; identifier: string; eventId: string },
): Promise<string | null> => {
  const own = specs.find(
    (spec) => spec.pubkey === shown.pubkey && spec.identifier === shown.identifier,
  );
  if (own !== undefined && own.event.id === shown.eventId) return own.content;
  try {
    const response = await fetch(eventPath(shown.npub, shown.identifier));
    if (!response.ok) return null;
    const event = (await response.json()) as NostrEvent;
    return event.id === shown.eventId ? event.content : null;
  } catch {
    return null;
  }
};

/**
 * Asked by the browser after the page is on screen, like the discussion and for
 * the same reason: the server renders the document for crawlers and cachers, and
 * who else has written it is not part of the document. When the indexer backend
 * exists, these two queries are what it replaces.
 *
 * Two questions because the relays answer two: who publishes at this address,
 * and who cites it. They go out together and are folded into one list, because
 * a copy found by both is one copy.
 *
 * The list is published first and the margin marks after: the section is a list
 * to draw, the marks cost a comparison per copy, and neither should wait on the
 * other.
 */
export const useCopies = (shown: {
  pubkey: string;
  npub: string;
  identifier: string;
  eventId: string;
  title: string;
}): Copies => {
  const [found, setFound] = useState<Copies>(NOTHING);
  const { pubkey, npub, identifier, eventId, title } = shown;

  useEffect(() => {
    let live = true;
    setFound(NOTHING);

    (async () => {
      try {
        // Caught one by one rather than together: the relays answer these
        // separately and a reader is owed whichever of the two came back, not
        // silence because the other did not.
        const [byName, byCitation] = await Promise.all([
          fetchSpecs({ identifiers: [identifier] }).catch(() => [] as Spec[]),
          fetchSpecs({ cites: [toCoordinate({ pubkey, identifier })] }).catch(() => [] as Spec[]),
        ]);
        if (!live) return;
        // One document answering both queries is one document, and the newer of
        // the two revisions is the one that counts.
        const specs = latestByCoordinate([...byName, ...byCitation]);
        const copies = selectCopies(specs, { pubkey, identifier });
        setFound({ copies, spots: [], standings: {} });
        if (copies.length === 0) return;

        const content = await baseContentOf(specs, { pubkey, npub, identifier, eventId });
        if (!live || content === null) return;
        const held = new Set(copies.map((copy) => `${copy.pubkey}:${copy.identifier}`));
        const others = specs.filter((spec) => held.has(`${spec.pubkey}:${spec.identifier}`));
        const { spots, standings } = compareCopies({ content, title, npub, identifier }, others);
        if (live) setFound({ copies, spots, standings });
      } catch {
        // A page that could not learn who else has written this still has its document.
      }
    })();

    return () => {
      live = false;
    };
  }, [pubkey, npub, identifier, eventId, title]);

  return found;
};
