import { Link } from "react-router";
import { SearchBox } from "~/components/search-box";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { PAGE_HEADERS } from "~/lib/http";
import { likeKey, useLikes } from "~/lib/likes";
import { publicOrigin } from "~/lib/origin.server";
import { atomPath, feedTitle, newSpecPath, rssPath, specsPath } from "~/lib/paths";
import { loadAuthors } from "~/lib/profile.server";
import { loadSpecs } from "~/lib/specs.server";
import type { Route } from "./+types/home";

const DESCRIPTION =
  "Protocols, formats and conventions, published as signed Nostr events and readable by anyone.";

export async function loader({ request }: Route.LoaderArgs) {
  // The front door stays up when the relays are unreachable, and says so. The
  // failed load is evicted from the cache, so the next request tries again.
  const specs = await loadSpecs().catch(() => []);
  const origin = publicOrigin(request);
  return {
    specs,
    authors: await loadAuthors(specs.map((spec) => spec.pubkey)),
    origin,
    canonical: `${origin}/`,
  };
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: "Open Specs" },
    { name: "description", content: DESCRIPTION },
    ...(loaderData ? [{ tagName: "link", rel: "canonical", href: loaderData.canonical }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: "Open Specs" },
    { property: "og:description", content: DESCRIPTION },
    ...(loaderData ? [{ property: "og:url", content: loaderData.canonical }] : []),
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: "Open Specs" },
    { name: "twitter:description", content: DESCRIPTION },
    ...(loaderData
      ? [
          {
            tagName: "link",
            rel: "alternate",
            type: "application/rss+xml",
            title: feedTitle(),
            href: `${loaderData.origin}${rssPath()}`,
          },
          {
            tagName: "link",
            rel: "alternate",
            type: "application/atom+xml",
            title: feedTitle(),
            href: `${loaderData.origin}${atomPath()}`,
          },
        ]
      : []),
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { specs, authors } = loaderData;
  const likes = useLikes(specs);

  return (
    <Shell search={false}>
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="max-w-3xl text-balance font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Technical specifications, signed and public
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted">
          Anyone can publish a protocol, a format or a convention here. Each document is a Nostr
          event signed by its author and stored on relays: this site renders and indexes them, it
          does not own them.
        </p>

        <div className="mt-10 max-w-xl">
          <SearchBox size="hero" />
        </div>

        {/* The header carries this too, but not on a phone and not in the size a
            first visit deserves. Reading is what the page offers first, writing
            is what it offers next. */}
        <p className="mt-4 font-serif text-[0.9375rem] leading-relaxed text-muted">
          Or{" "}
          <Link
            to={newSpecPath()}
            className="text-ink underline decoration-rule underline-offset-2 hover:decoration-current"
          >
            write a document
          </Link>{" "}
          of your own.
        </p>

        <section className="mt-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
              Recently published
            </h2>
            <Link
              to={specsPath()}
              className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] underline underline-offset-4"
            >
              Browse all
            </Link>
          </div>
          {specs.length === 0 ? (
            <p className="mt-6 border-t border-rule pt-6 font-serif text-muted">
              No documents came back from the relays. They may be unreachable from this server right
              now.
            </p>
          ) : (
            <ul className="mt-6">
              {specs.map((spec) => (
                <SpecRow
                  key={spec.path}
                  spec={spec}
                  author={authors[spec.pubkey] ?? null}
                  likes={likes[likeKey(spec)] ?? null}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </Shell>
  );
}
