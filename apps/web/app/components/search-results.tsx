import { useMemo } from "react";
import { useShown } from "~/lib/blocked";
import { likeKey, useLikes } from "~/lib/likes";
import { specsPath } from "~/lib/paths";
import type { Authors } from "~/lib/profile";
import { searchTerms } from "~/lib/search";
import type { SearchPage } from "~/lib/search.server";
import { Pagination } from "./pagination";
import { SpecRow } from "./spec-row";

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The page of results the server found, drawn as the listing's rows with the words marked. */
export const SearchResults = ({
  query,
  topic,
  kind,
  search,
  authors,
}: {
  query: string;
  topic: string | null;
  kind: number | null;
  search: SearchPage;
  authors: Authors;
}) => {
  const terms = useMemo(() => searchTerms(query), [query]);
  const rows = useShown(search.rows);
  const likes = useLikes(rows);
  const { results, documents, page, pages } = search;

  if (search.reading) {
    return (
      <p className="mt-10 border-t border-rule pt-6 font-serif text-muted">
        This server has only just started and is still reading the documents. Try again in a moment.
      </p>
    );
  }

  return (
    <>
      <p className="mt-10 border-t border-rule pt-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
        {`${plural(results, "result")} in ${plural(documents, "document")}`}
        {pages > 1 && `, page ${page} of ${pages}`}
      </p>

      {results === 0 ? (
        <p className="mt-6 font-serif text-muted">
          No document carries these words. Try fewer of them.
        </p>
      ) : (
        <>
          <ul className="mt-6">
            {rows.map((row) => (
              <SpecRow
                key={row.path}
                spec={row}
                author={authors[row.pubkey] ?? null}
                excerpt={row.excerpt}
                terms={terms}
                likes={likes[likeKey(row)] ?? null}
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
