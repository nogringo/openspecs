import { useEffect, useMemo, useSyncExternalStore } from "react";
import { corpusState, serverCorpusState, startCorpus, subscribeCorpus } from "~/lib/corpus";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { searchDocs, searchTerms } from "~/lib/search";
import { SpecRow } from "./spec-row";

const LIMIT = 60;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The relays index tags, not prose, so a search cannot be asked of them. The
 * corpus is read into the browser once and the query is answered against it
 * here, which is also why this page is the only one the server does not render.
 */
export const SearchResults = ({
  query,
  topic,
  kind,
}: {
  query: string;
  topic: string | null;
  kind: number | null;
}) => {
  useEffect(startCorpus, []);
  const { docs, status, read } = useSyncExternalStore(
    subscribeCorpus,
    corpusState,
    serverCorpusState,
  );

  const scoped = useMemo(
    () =>
      docs.filter(
        (doc) =>
          (topic === null || doc.topics.includes(topic)) &&
          (kind === null || doc.kinds.some((ref) => ref.kind === kind)),
      ),
    [docs, topic, kind],
  );
  const hits = useMemo(() => searchDocs(scoped, query, LIMIT), [scoped, query]);
  const terms = useMemo(() => searchTerms(query), [query]);

  // Only the authors a reader ended up in front of: the corpus holds far more.
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  useEffect(() => {
    wantAuthors(hits.map((hit) => hit.doc.pubkey));
  }, [hits]);

  const walking = status === "idle" || status === "loading" || status === "syncing";
  const count = walking
    ? `${plural(hits.length, "result")} so far, ${read} read`
    : `${plural(hits.length, "result")} in ${plural(scoped.length, "document")}`;

  if (status === "failed" && docs.length === 0) {
    return (
      <p className="mt-10 border-t border-rule pt-6 font-serif text-muted">
        No documents came back from the relays. Search reads them from your browser, and they may be
        unreachable from it right now.
      </p>
    );
  }

  return (
    <>
      <p
        aria-live="polite"
        className="mt-10 border-t border-rule pt-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted"
      >
        {count}
        {status === "failed" && ", some relays did not answer"}
      </p>

      {hits.length === 0 ? (
        <p className="mt-6 font-serif text-muted">
          {walking
            ? "Reading the corpus from the relays."
            : "No document carries these words. Try fewer of them."}
        </p>
      ) : (
        <ul className="mt-6">
          {hits.map((hit) => (
            <SpecRow
              key={hit.doc.path}
              spec={hit.doc}
              author={authors[hit.doc.pubkey] ?? null}
              excerpt={hit.excerpt}
              terms={terms}
            />
          ))}
        </ul>
      )}
    </>
  );
};
