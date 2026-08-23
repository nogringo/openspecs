import { Link, type ShouldRevalidateFunctionArgs } from "react-router";
import { ErrorPage } from "~/components/error-page";
import { Pagination } from "~/components/pagination";
import { SearchResults } from "~/components/search-results";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { parsePage, parseSearchQuery, parseSpecFilter } from "~/lib/filter";
import { PAGE_HEADERS } from "~/lib/http";
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
import { LISTING_WINDOW, loadSpecs } from "~/lib/specs.server";
import { topicsByFrequency } from "~/lib/topics";
import type { Route } from "./+types/specs";

/** Short enough that a page is one glance down the listing. */
const PAGE_SIZE = 20;
/** Enough to browse by, few enough to read at a glance. */
const TOPICS_SHOWN = 14;

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const { topic, kind } = parseSpecFilter(params);
  const query = parseSearchQuery(params);
  const filtered = topic !== undefined || kind !== undefined;

  const origin = publicOrigin(request);
  // The unfiltered listing is the home page's, already loaded and cached.
  const [listing, all] = await Promise.all([
    loadSpecs({ topic, kind }, LISTING_WINDOW).catch(() => []),
    loadSpecs({}, 30).catch(() => []),
  ]);

  const { items, page, pages } = pageOf(listing, parsePage(params), PAGE_SIZE);
  const pageUrl = (n: number) => `${origin}${specsPath({ topic, kind, page: n })}`;

  return {
    specs: items,
    page,
    pages,
    // Only the page being shown: a profile lookup for every document in the
    // window would be what this listing actually costs.
    authors: await loadAuthors(items.map((spec) => spec.pubkey)),
    // Counted over the unfiltered listing: under a filter it would only ever
    // offer the filter already applied.
    topics: topicsByFrequency(all, TOPICS_SHOWN),
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

/**
 * A search is answered in the browser, so the loader owes it nothing: asking the
 * server again on every keystroke would fetch the listing it already has. Its
 * pages are answered there too, out of results already in hand, so only a page
 * of the server's own listing is worth another round trip.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const listing = (url: URL) => {
    const params = url.searchParams;
    const page = parseSearchQuery(params) === undefined ? params.get("page") : null;
    return `${params.get("topic")}:${params.get("kind")}:${page}`;
  };
  return listing(currentUrl) === listing(nextUrl) ? false : defaultShouldRevalidate;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Specifications | Open Specs" }];

  const query = { topic: loaderData.topic ?? undefined, kind: loaderData.kind ?? undefined };
  const listing = listingTitle({ ...query, q: loaderData.query ?? undefined });
  const description = listingDescription(query);

  // Results are read out of the visitor's browser, so there is no page here to
  // index and no canonical to point a crawler at.
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
  <Link
    to={to}
    className={
      active
        ? "rounded-sm bg-ink px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper"
        : "rounded-sm px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink"
    }
  >
    {children}
  </Link>
);

export default function Specs({ loaderData }: Route.ComponentProps) {
  const { specs, authors, topics, topic, kind, query, filtered, page, pages } = loaderData;

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

        {query !== null ? (
          <>
            <SearchResults query={query} topic={topic} kind={kind} />
            <noscript>
              <p className="mt-6 font-serif text-muted">
                Search reads the documents into your browser and looks through them there, which
                needs JavaScript. Without it, the documents are still there to{" "}
                <Link to={specsPath()} className="underline underline-offset-4">
                  browse
                </Link>
                .
              </p>
            </noscript>
          </>
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
                <SpecRow key={spec.path} spec={spec} author={authors[spec.pubkey] ?? null} />
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
