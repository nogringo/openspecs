import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { corpusState, serverCorpusState, startCorpus, subscribeCorpus } from "~/lib/corpus";
import { parsePage } from "~/lib/filter";
import { likeKey, useLikes } from "~/lib/likes";
import { pageOf } from "~/lib/pagination";
import { specsPath } from "~/lib/paths";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { searchDocs, searchTerms } from "~/lib/search";
import { Pagination } from "./pagination";
import { SpecRow } from "./spec-row";

const PAGE_SIZE = 20;

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

  // Read off the URL rather than the loader: the server is not asked again when
  // only the page changed, so its idea of which page this is would be stale.
  const [params] = useSearchParams();

  const scoped = useMemo(
    () =>
      docs.filter(
        (doc) =>
          (topic === null || doc.topics.includes(topic)) &&
          (kind === null || doc.kinds.some((ref) => ref.kind === kind)),
      ),
    [docs, topic, kind],
  );
  const hits = useMemo(() => searchDocs(scoped, query), [scoped, query]);
  const terms = useMemo(() => searchTerms(query), [query]);
  // The corpus arrives in pages of its own, so the last page grows under the
  // reader while the relays are still being read. Clamping is what absorbs it.
  const requested = parsePage(params);
  const { items, page, pages } = useMemo(
    () => pageOf(hits, requested, PAGE_SIZE),
    [hits, requested],
  );

  // Only the authors a reader ended up in front of: the corpus holds far more.
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  useEffect(() => {
    wantAuthors(items.map((hit) => hit.doc.pubkey));
  }, [items]);
  const rows = useMemo(() => items.map((hit) => hit.doc), [items]);
  const likes = useLikes(rows);

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
        {pages > 1 && `, page ${page} of ${pages}`}
        {status === "failed" && ", some relays did not answer"}
      </p>

      {hits.length === 0 ? (
        <p className="mt-6 font-serif text-muted">
          {walking
            ? "Reading the corpus from the relays."
            : "No document carries these words. Try fewer of them."}
        </p>
      ) : (
        <>
          <ul className="mt-6">
            {items.map((hit) => (
              <SpecRow
                key={hit.doc.path}
                spec={hit.doc}
                author={authors[hit.doc.pubkey] ?? null}
                excerpt={hit.excerpt}
                terms={terms}
                likes={likes[likeKey(hit.doc)] ?? null}
              />
            ))}
          </ul>
          <Pagination
            page={page}
            pages={pages}
            href={(n) =>
              specsPath({ q: query, topic: topic ?? undefined, kind: kind ?? undefined, page: n })
            }
            label="Search results"
          />
        </>
      )}
    </>
  );
};
