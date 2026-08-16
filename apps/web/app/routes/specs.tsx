import { Link } from "react-router";
import { ErrorPage } from "~/components/error-page";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
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

const TOPIC = /^[a-z0-9][a-z0-9\-_.]{0,63}$/;

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const rawTopic = params.get("topic")?.trim().toLowerCase() ?? "";
  const rawKind = params.get("kind")?.trim() ?? "";

  const topic = TOPIC.test(rawTopic) ? rawTopic : undefined;
  const kind = /^\d{1,7}$/.test(rawKind) ? Number(rawKind) : undefined;
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

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Specifications | Open Specs" }];

  const query = { topic: loaderData.topic ?? undefined, kind: loaderData.kind ?? undefined };
  const title = listingTitle(query);
  const description = listingDescription(query);

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
  const { specs, topics, topic, kind, filtered } = loaderData;

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="font-mono text-2xl font-medium tracking-tight sm:text-3xl">
          {listingTitle({ topic: topic ?? undefined, kind: kind ?? undefined })}
        </h1>

        <nav aria-label="Topics" className="mt-8 flex flex-wrap items-center gap-1">
          <Chip to={specsPath()} active={!filtered}>
            all
          </Chip>
          {topics.map((name) => (
            <Chip key={name} to={specsPath({ topic: name })} active={name === topic}>
              {`#${name}`}
            </Chip>
          ))}
          {kind !== null && (
            <Chip to={specsPath({ kind })} active>
              {`kind ${kind}`}
            </Chip>
          )}
        </nav>

        {specs.length === 0 ? (
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
