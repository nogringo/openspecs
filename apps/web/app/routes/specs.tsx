import { Link } from "react-router";
import { TAB_OFF, TAB_ON } from "~/components/chrome";
import { ErrorPage } from "~/components/error-page";
import { Pagination } from "~/components/pagination";
import { SearchResults } from "~/components/search-results";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { useShown } from "~/lib/blocked";
import { parsePage, parseSearchQuery, parseSpecFilter } from "~/lib/filter";
import { PAGE_HEADERS } from "~/lib/http";
import { likeKey, useLikes } from "~/lib/likes";
import { publicOrigin } from "~/lib/origin.server";
import { pageOf } from "~/lib/pagination";
import {
  atomPath,
  feedTitle,
  listingDescription,
  listingTitle,
  rssPath,
  specsPath,
} from "~/lib/paths";
import { loadAuthors } from "~/lib/profile.server";
import { searchSpecs } from "~/lib/search.server";
import { LISTING_WINDOW, loadSpecs, type SpecCard } from "~/lib/specs.server";
import { topicsByFrequency } from "~/lib/topics";
import type { Route } from "./+types/specs";

/** Short enough that a page is one glance down the listing. */
const PAGE_SIZE = 20;

const NO_ROWS: SpecCard[] = [];
/** Enough to browse by, few enough to read at a glance. */
const TOPICS_SHOWN = 14;

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const { topic, kind } = parseSpecFilter(params);
  const query = parseSearchQuery(params);
  const filtered = topic !== undefined || kind !== undefined;

  const origin = publicOrigin(request);
  const search =
    query === undefined
      ? null
      : await searchSpecs({
          query,
          topic,
          kind,
          page: parsePage(params),
          pageSize: PAGE_SIZE,
          topicsShown: TOPICS_SHOWN,
        });
  // The unfiltered listing is the home page's, already loaded and cached.
  const [listing, all] =
    search === null
      ? await Promise.all([
          loadSpecs({ topic, kind }, LISTING_WINDOW).catch(() => []),
          loadSpecs({}, 30).catch(() => []),
        ])
      : [NO_ROWS, NO_ROWS];

  const { items, page, pages } =
    search === null ? pageOf(listing, parsePage(params), PAGE_SIZE) : { ...search, items: NO_ROWS };
  const pageUrl = (n: number) => `${origin}${specsPath({ topic, kind, page: n })}`;

  return {
    specs: items,
    search,
    page,
    pages,
    // Only the page being shown: a profile lookup for every document in the
    // window would be what this listing actually costs.
    authors: await loadAuthors((search?.rows ?? items).map((spec) => spec.pubkey)),
    // Counted over the unfiltered listing: under a filter it would only ever
    // offer the filter already applied. A search offers the topics of what it
    // found instead, to narrow it.
    topics: search?.topics ?? topicsByFrequency(all, TOPICS_SHOWN),
    topic: topic ?? null,
    kind: kind ?? null,
    query: query ?? null,
    // Canonical drops anything the filter did not recognise, so one listing is
    // never indexed under a dozen spellings of the same query. The page is the
    // clamped one, so a number past the end still points at a page there is.
    origin,
    canonical: pageUrl(page),
    previous: page > 1 ? pageUrl(page - 1) : null,
    next: page < pages ? pageUrl(page + 1) : null,
    filtered,
  };
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Specifications | Open Specs" }];

  const query = { topic: loaderData.topic ?? undefined, kind: loaderData.kind ?? undefined };
  const listing = listingTitle({ ...query, q: loaderData.query ?? undefined });
  const description = listingDescription(query);

  // A search is a question rather than a page: indexing every query would fill
  // the index with partial copies of the listing.
  if (loaderData.query !== null) {
    return [{ title: `${listing} | Open Specs` }, { name: "robots", content: "noindex, follow" }];
  }

  // Every page holds different documents, so each one says which it is rather
  // than sitting in a result list under the same title as the others.
  const { page, previous, next } = loaderData;
  const title = page === 1 ? listing : `${listing}, page ${page}`;

  return [
    { title: `${title} | Open Specs` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: loaderData.canonical },
    // Kept so a crawler walks the whole listing rather than the first page of it.
    ...(previous === null ? [] : [{ tagName: "link", rel: "prev", href: previous }]),
    ...(next === null ? [] : [{ tagName: "link", rel: "next", href: next }]),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: loaderData.canonical },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    {
      tagName: "link",
      rel: "alternate",
      type: "application/rss+xml",
      title: feedTitle(query),
      href: `${loaderData.origin}${rssPath(query)}`,
    },
    {
      tagName: "link",
      rel: "alternate",
      type: "application/atom+xml",
      title: feedTitle(query),
      href: `${loaderData.origin}${atomPath(query)}`,
    },
  ];
}

const Chip = ({ to, active, children }: { to: string; active: boolean; children: string }) => (
  <Link to={to} className={active ? TAB_ON : TAB_OFF}>
    {children}
  </Link>
);

export default function Specs({ loaderData }: Route.ComponentProps) {
  const { authors, topics, topic, kind, query, filtered, page, pages } = loaderData;
  const specs = useShown(loaderData.specs);
  // Under a search the rows on screen are the results', which ask for their own.
  const likes = useLikes(query === null ? specs : NO_ROWS);

  return (
    <Shell query={query ?? undefined}>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="font-mono text-2xl font-medium tracking-tight sm:text-3xl">
          {listingTitle({
            topic: topic ?? undefined,
            kind: kind ?? undefined,
            q: query ?? undefined,
          })}
        </h1>

        <nav aria-label="Topics" className="mt-8 flex flex-wrap items-center gap-1">
          <Chip to={specsPath({ q: query ?? undefined })} active={!filtered}>
            all
          </Chip>
          {topics.map((name) => (
            <Chip
              key={name}
              to={specsPath({ topic: name, q: query ?? undefined })}
              active={name === topic}
            >
              {`#${name}`}
            </Chip>
          ))}
          {kind !== null && (
            <Chip to={specsPath({ kind, q: query ?? undefined })} active>
              {`kind ${kind}`}
            </Chip>
          )}
        </nav>

        {query !== null && loaderData.search !== null ? (
          <SearchResults
            query={query}
            topic={topic}
            kind={kind}
            search={loaderData.search}
            authors={authors}
          />
        ) : specs.length === 0 ? (
          <p className="mt-10 border-t border-rule pt-6 font-serif text-muted">
            {filtered
              ? "No document here carries this tag yet."
              : "No documents came back from the relays. They may be unreachable from this server right now."}
          </p>
        ) : (
          <>
            {pages > 1 && (
              <p className="mt-10 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
                {`Page ${page} of ${pages}`}
              </p>
            )}
            <ul className={pages > 1 ? "mt-6" : "mt-10"}>
              {specs.map((spec) => (
                <SpecRow
                  key={spec.path}
                  spec={spec}
                  author={authors[spec.pubkey] ?? null}
                  likes={likes[likeKey(spec)] ?? null}
                />
              ))}
            </ul>
            <Pagination
              page={page}
              pages={pages}
              href={(n) =>
                specsPath({ topic: topic ?? undefined, kind: kind ?? undefined, page: n })
              }
              label="Specifications"
            />
          </>
        )}
      </main>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
