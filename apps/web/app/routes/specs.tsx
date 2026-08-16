import { Link, type ShouldRevalidateFunctionArgs } from "react-router";
import { ErrorPage } from "~/components/error-page";
import { SearchResults } from "~/components/search-results";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { parseSearchQuery, parseSpecFilter } from "~/lib/filter";
import { PAGE_HEADERS } from "~/lib/http";
import { publicOrigin } from "~/lib/origin.server";
import {
  atomPath,
  feedTitle,
  listingDescription,
  listingTitle,
  rssPath,
  specsPath,
} from "~/lib/paths";
import { loadSpecs } from "~/lib/specs.server";
import { topicsByFrequency } from "~/lib/topics";
import type { Route } from "./+types/specs";

const LIMIT = 60;
/** Enough to browse by, few enough to read at a glance. */
const TOPICS_SHOWN = 14;

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const { topic, kind } = parseSpecFilter(params);
  const query = parseSearchQuery(params);
  const filtered = topic !== undefined || kind !== undefined;

  const origin = publicOrigin(request);
  // The unfiltered listing is the home page's, already loaded and cached.
  const [specs, all] = await Promise.all([
    loadSpecs({ topic, kind }, LIMIT).catch(() => []),
    loadSpecs({}, 30).catch(() => []),
  ]);

  return {
    specs,
    // Counted over the unfiltered listing: under a filter it would only ever
    // offer the filter already applied.
    topics: topicsByFrequency(all, TOPICS_SHOWN),
    topic: topic ?? null,
    kind: kind ?? null,
    query: query ?? null,
    // Canonical drops anything the filter did not recognise, so one listing is
    // never indexed under a dozen spellings of the same query.
    origin,
    canonical: `${origin}${specsPath({ topic, kind })}`,
    filtered,
  };
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * A search is answered in the browser, so the loader owes it nothing: asking the
 * server again on every keystroke would fetch the listing it already has.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const listing = (url: URL) => `${url.searchParams.get("topic")}:${url.searchParams.get("kind")}`;
  return listing(currentUrl) === listing(nextUrl) ? false : defaultShouldRevalidate;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Specifications | Open Specs" }];

  const query = { topic: loaderData.topic ?? undefined, kind: loaderData.kind ?? undefined };
  const title = listingTitle({ ...query, q: loaderData.query ?? undefined });
  const description = listingDescription(query);

  // Results are read out of the visitor's browser, so there is no page here to
  // index and no canonical to point a crawler at.
  if (loaderData.query !== null) {
    return [{ title: `${title} | Open Specs` }, { name: "robots", content: "noindex, follow" }];
  }

  return [
    { title: `${title} | Open Specs` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: loaderData.canonical },
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
  const { specs, topics, topic, kind, query, filtered } = loaderData;

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
          <ul className="mt-10">
            {specs.map((spec) => (
              <SpecRow key={spec.path} spec={spec} />
            ))}
          </ul>
        )}
      </main>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
