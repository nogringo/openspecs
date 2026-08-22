import { fetchSpec } from "@openspecs/nostr";
import { useEffect, useState } from "react";
import { isNewerRevision, type SpecPage, toPage } from "./spec-page";

export type LiveRevision = {
  /** What the page draws: the revision it was served with, until somebody asks for another. */
  shown: SpecPage;
  /** A newer revision the relays hold, waiting to be asked for. Null while there is none. */
  fresher: SpecPage | null;
  show: () => void;
};

/**
 * A document page is served from a cache. This server keeps its own copy for a
 * minute and tells any cache in front of it that a day old copy may be served
 * while a fresh one is fetched, so the revision a reader arrives on is the one
 * that was live when the cache was filled rather than the one live now.
 *
 * Nothing can tell that cache a document changed: a browser may not write to
 * this server, which is the rule the whole project is built on. So the reader's
 * own browser asks the relays instead, once, after the page is already on
 * screen. The server still renders the whole document for anyone without
 * JavaScript and for every crawler, which is why this is an effect rather than a
 * `clientLoader`.
 *
 * It offers rather than replaces. Somebody halfway down a paragraph should not
 * have it rewritten under them, and an author who has just published wants to
 * know what happened rather than wonder whether they saw the old copy.
 */
export const useLiveRevision = (served: SpecPage): LiveRevision => {
  const [shown, setShown] = useState(served);
  const [fresher, setFresher] = useState<SpecPage | null>(null);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const found = await fetchSpec({
          pubkey: served.pubkey,
          identifier: served.identifier,
        });
        // A relay that answers with a superseded revision is answering honestly,
        // and is exactly what `isNewerRevision` is there to ignore.
        if (!live || found === null || !isNewerRevision(found, served)) return;
        setFresher(toPage(found));
      } catch {
        // A page that is already readable does not report that it could not be
        // checked. The revision it holds was signed, whatever its age.
      }
    })();

    return () => {
      live = false;
    };
  }, [served]);

  return {
    shown,
    fresher,
    show: () => {
      if (fresher === null) return;
      setShown(fresher);
      setFresher(null);
    },
  };
};
