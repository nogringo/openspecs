import { fetchSpecs, type NostrEvent, type Spec, specPath, toNpub } from "@openspecs/nostr";
import { useEffect, useState } from "react";
import { eventPath } from "./paths";
import { compareCopies, type Spot, type Standing } from "./spots";

/** Another key's document under the same identifier, reduced to what its row draws. */
export type Variant = {
  pubkey: string;
  npub: string;
  title: string;
  summary: string;
  revisedAt: number;
  path: string;
};

/**
 * The other keys publishing under this identifier. The one on the page is
 * dropped because its document is the page, and blank records are dropped the
 * way listings drop them. Newest revision first, which is the order everything
 * else on this site lists in: any other order would be a ranking, and ranking
 * the versions of a name is the one call this site refuses to make.
 */
export const selectVariants = (specs: Spec[], shownPubkey: string): Variant[] =>
  specs
    .filter((spec) => spec.pubkey !== shownPubkey && !spec.isEmpty)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((spec) => ({
      pubkey: spec.pubkey,
      npub: toNpub(spec.pubkey),
      title: spec.title,
      summary: spec.summary,
      revisedAt: spec.createdAt,
      path: specPath(spec),
    }));

export type UnderThisName = {
  variants: Variant[];
  /** The places in the shown revision where those copies differ, for the margin. */
  spots: Spot[];
  /** Each copy's standing against the shown revision, for its card. */
  standings: Record<string, Standing>;
};

const NOTHING: UnderThisName = { variants: [], spots: [], standings: {} };

/**
 * The marks must sit on the text the reader is looking at, so the base source
 * has to be the shown revision exactly. The relays usually hand it back in the
 * same query that found the variants; when they hold another revision, the
 * server's own copy of the event is the one the page was rendered from.
 */
const baseContentOf = async (
  specs: Spec[],
  shown: { pubkey: string; npub: string; identifier: string; eventId: string },
): Promise<string | null> => {
  const own = specs.find((spec) => spec.pubkey === shown.pubkey);
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
 * who else signs its name is not part of the document. When the indexer backend
 * exists, this one query is what it replaces.
 *
 * The variants are published first and the margin marks after: the section is a
 * list to draw, the marks cost a comparison per copy, and neither should wait
 * on the other.
 */
export const useVariants = (shown: {
  pubkey: string;
  npub: string;
  identifier: string;
  eventId: string;
  title: string;
}): UnderThisName => {
  const [found, setFound] = useState<UnderThisName>(NOTHING);
  const { pubkey, npub, identifier, eventId, title } = shown;

  useEffect(() => {
    let live = true;
    setFound(NOTHING);

    (async () => {
      try {
        const specs = await fetchSpecs({ identifiers: [identifier] });
        if (!live) return;
        const variants = selectVariants(specs, pubkey);
        setFound({ variants, spots: [], standings: {} });
        if (variants.length === 0) return;

        const content = await baseContentOf(specs, { pubkey, npub, identifier, eventId });
        if (!live || content === null) return;
        const others = specs.filter((spec) => spec.pubkey !== pubkey && !spec.isEmpty);
        const { spots, standings } = compareCopies({ content, title, npub, identifier }, others);
        if (live) setFound({ variants, spots, standings });
      } catch {
        // A page that could not learn who else signs this name still has its document.
      }
    })();

    return () => {
      live = false;
    };
  }, [pubkey, npub, identifier, eventId, title]);

  return found;
};
