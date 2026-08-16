import { Link } from "react-router";
import { KeyMark } from "~/components/key-mark";
import { Shell } from "~/components/shell";
import { SpecTags } from "~/components/spec-tags";
import { PAGE_HEADERS } from "~/lib/http";
import { publicOrigin } from "~/lib/origin.server";
import { loadRecentSpecs, type SpecCard } from "~/lib/specs.server";
import type { Route } from "./+types/home";

const DESCRIPTION =
  "Protocols, formats and conventions, published as signed Nostr events and readable by anyone.";

export async function loader({ request }: Route.LoaderArgs) {
  // The front door stays up when the relays are unreachable, and says so. The
  // failed load is evicted from the cache, so the next request tries again.
  const specs = await loadRecentSpecs().catch(() => []);
  return { specs, canonical: `${publicOrigin(request)}/` };
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
  ];
}

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

const Row = ({ spec }: { spec: SpecCard }) => (
  <li className="border-t border-rule">
    <Link to={spec.path} className="group block py-6">
      <div className="flex gap-4">
        <span className="mt-1 shrink-0">
          <KeyMark pubkey={spec.pubkey} size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="min-w-0 font-mono text-base font-medium group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
              {spec.title}
            </h3>
            <time
              dateTime={new Date(spec.publishedAt * 1000).toISOString()}
              className="shrink-0 font-mono text-xs text-muted"
            >
              {asDate(spec.publishedAt)}
            </time>
          </div>
          {spec.summary !== "" && (
            <p className="mt-2 line-clamp-2 max-w-[44rem] font-serif text-muted">{spec.summary}</p>
          )}
          <div className="mt-3">
            <SpecTags status={spec.status} kinds={spec.kinds} topics={spec.topics} />
          </div>
        </div>
      </div>
    </Link>
  </li>
);

export default function Home({ loaderData }: Route.ComponentProps) {
  const { specs } = loaderData;

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="max-w-3xl text-balance font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Technical specifications, signed and public
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted">
          Anyone can publish a protocol, a format or a convention here. Each document is a Nostr
          event signed by its author and stored on relays: this site renders and indexes them, it
          does not own them.
        </p>

        <section className="mt-20">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
            Recently published
          </h2>
          {specs.length === 0 ? (
            <p className="mt-6 border-t border-rule pt-6 font-serif text-muted">
              No documents came back from the relays. They may be unreachable from this server right
              now.
            </p>
          ) : (
            <ul className="mt-6">
              {specs.map((spec) => (
                <Row key={spec.path} spec={spec} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </Shell>
  );
}
