import { fetchSpecs, type Spec, specPath, toNpub } from "@openspecs/nostr";
import { useEffect, useState } from "react";

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

/**
 * Asked by the browser after the page is on screen, like the discussion and for
 * the same reason: the server renders the document for crawlers and cachers, and
 * who else signs its name is not part of the document. When the indexer backend
 * exists, this one query is what it replaces.
 */
export const useVariants = (shown: { pubkey: string; identifier: string }): Variant[] => {
  const [variants, setVariants] = useState<Variant[]>([]);
  const { pubkey, identifier } = shown;

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const specs = await fetchSpecs({ identifiers: [identifier] });
        if (!live) return;
        setVariants(selectVariants(specs, pubkey));
      } catch {
        // A page that could not learn who else signs this name still has its document.
      }
    })();

    return () => {
      live = false;
    };
  }, [pubkey, identifier]);

  return variants;
};
