import { fetchSpecs, type Spec, specPath, toCoordinate, toNpub } from "@openspecs/nostr";
import { useEffect, useState } from "react";

/** A document that says it came from this one, reduced to what its row draws. */
export type Fork = {
  pubkey: string;
  npub: string;
  identifier: string;
  title: string;
  summary: string;
  revisedAt: number;
  path: string;
  /** True where it kept the name it was forked from, which is what makes it a variant too. */
  sameName: boolean;
};

/**
 * The documents declaring this one as where they came from.
 *
 * Relays index a tag's value and not the marker after it, so the query behind
 * this returns everything citing the coordinate at all: an `update`, an
 * `extends`, a page of a documentation space. The marker is checked here, which
 * is the whole reason a filter cannot be trusted to have done it.
 *
 * A document naming itself is dropped, and so are the blank ones, the way every
 * listing drops them. Newest revision first, like everything else on this site.
 */
export const selectForks = (specs: Spec[], of: { pubkey: string; identifier: string }): Fork[] => {
  const coordinate = toCoordinate(of);
  return specs
    .filter(
      (spec) =>
        !spec.isEmpty &&
        !(spec.pubkey === of.pubkey && spec.identifier === of.identifier) &&
        spec.forks.some((fork) => fork.type === "spec" && fork.coordinate === coordinate),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((spec) => ({
      pubkey: spec.pubkey,
      npub: toNpub(spec.pubkey),
      identifier: spec.identifier,
      title: spec.title,
      summary: spec.summary,
      revisedAt: spec.createdAt,
      path: specPath(spec),
      sameName: spec.identifier === of.identifier,
    }));
};

/**
 * Asked by the browser after the page is on screen, like the variants and the
 * discussion: who wrote a document from this one is not part of the document,
 * and a crawler has no use for it.
 */
export const useForks = (of: { pubkey: string; identifier: string }): Fork[] => {
  const [found, setFound] = useState<Fork[]>([]);
  const { pubkey, identifier } = of;

  useEffect(() => {
    let live = true;
    setFound([]);

    fetchSpecs({ cites: [toCoordinate({ pubkey, identifier })] })
      .then((specs) => {
        if (live) setFound(selectForks(specs, { pubkey, identifier }));
      })
      // A page that could not learn who wrote from it still has its document.
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [pubkey, identifier]);

  return found;
};
