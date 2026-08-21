import {
  authorPath,
  parsePubkey,
  parseSpecAddress,
  resolveNip05,
  specPath,
  toNpub,
} from "@openspecs/nostr";
import { data, redirect } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { CopyButton } from "~/components/copy-button";
import { ErrorPage } from "~/components/error-page";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { publicOrigin } from "~/lib/origin.server";
import { authorAtomPath, authorOgImagePath, authorRssPath } from "~/lib/paths";
import { type Author, authorDescription, authorName } from "~/lib/profile";
import { loadAuthor } from "~/lib/profile.server";
import { loadAuthorSpecs, type SpecCard } from "~/lib/specs.server";
import type { Route } from "./+types/author";

/**
 * Only the `name@domain` form is resolved here. A bare domain is a NIP-05
 * address too, but at the root of the site it would turn every mistyped path
 * into a request this server makes to a stranger's host.
 */
const fromNip05 = async (input: string): Promise<string | null> =>
  input.includes("@") ? ((await resolveNip05(input))?.pubkey ?? null) : null;

export async function loader({ params, request }: Route.LoaderArgs) {
  // An naddr names a document rather than the author who signed it, so it is
  // translated and left behind. It has never rendered a page of its own.
  const pointer = parseSpecAddress(params.author);
  if (pointer !== null) throw redirect(specPath(pointer), 301);

  const pubkey = parsePubkey(params.author) ?? (await fromNip05(params.author));
  if (pubkey === null) {
    throw data({ missing: "address" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  // One author, one URL: a hex key, an nprofile and a NIP-05 address all name
  // the same person, and only the npub is the name that cannot be taken away.
  const npub = toNpub(pubkey);
  const path = authorPath(pubkey);
  if (params.author !== npub) throw redirect(path, 301);

  const [author, specs] = await Promise.all([loadAuthor(pubkey), loadAuthorSpecs(pubkey)]);
  // A key with neither a document nor a profile is not a page. Relays hold
  // millions of them, and every one would be an empty page to be crawled.
  if (author === null && specs.length === 0) {
    throw data({ missing: "author" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const origin = publicOrigin(request);
  return {
    pubkey,
    npub,
    author,
    specs,
    origin,
    canonical: `${origin}${path}`,
    ogImage: `${origin}${authorOgImagePath(npub)}`,
  };
}

export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? PAGE_HEADERS;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Author | Open Specs" }];

  const { author, npub, specs, canonical, origin, ogImage } = loaderData;
  const name = authorName(author, npub);
  const description = authorDescription(author, npub, specs.length);

  return [
    { title: `${name} | Open Specs` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    // An author with nothing published is a page for whoever typed the key, not
    // one for an index: there is nothing on it to find.
    ...(specs.length === 0 ? [{ name: "robots", content: "noindex, follow" }] : []),

    { property: "og:type", content: "profile" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: name },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: name },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },

    {
      tagName: "link",
      rel: "alternate",
      type: "application/rss+xml",
      title: `Open Specs, ${name}`,
      href: `${origin}${authorRssPath(npub)}`,
    },
    {
      tagName: "link",
      rel: "alternate",
      type: "application/atom+xml",
      title: `Open Specs, ${name}`,
      href: `${origin}${authorAtomPath(npub)}`,
    },

    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        url: canonical,
        mainEntity: {
          "@type": "Person",
          name,
          url: canonical,
          // The key stays the identifier whatever the author calls themselves today.
          identifier: `nostr:${npub}`,
          ...(author?.name && { alternateName: npub }),
          ...(author?.picture && { image: author.picture }),
          ...(author?.about && { description: author.about }),
        },
      },
    },
  ];
}

const shelf = (count: number): string => {
  if (count === 0) return "No specification";
  return count === 1 ? "One specification" : `${count} specifications`;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-20 shrink-0 text-muted">{label}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </div>
);

const FeedLink = ({ to, children }: { to: string; children: string }) => (
  <a
    href={to}
    className="rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink"
  >
    {children}
  </a>
);

const Masthead = ({
  pubkey,
  npub,
  author,
  specs,
}: {
  pubkey: string;
  npub: string;
  author: Author | null;
  specs: SpecCard[];
}) => {
  const oldest = specs.reduce(
    (first, spec) => Math.min(first, spec.publishedAt),
    Number.POSITIVE_INFINITY,
  );

  return (
    <header>
      <div className="flex items-start gap-5">
        <AuthorAvatar pubkey={pubkey} picture={author?.picture ?? null} size={72} />
        <div className="min-w-0">
          <h1 className="break-all font-mono text-2xl font-medium tracking-tight sm:text-3xl">
            {authorName(author, npub)}
          </h1>
          {/* A claim the author makes about themselves, which nothing here resolves. */}
          {author?.nip05 && (
            <p className="mt-2 break-all font-mono text-xs text-muted">{author.nip05}</p>
          )}
        </div>
      </div>

      {author?.about && (
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted">
          {author.about}
        </p>
      )}

      <dl className="mt-8 min-w-0 space-y-1 font-mono text-xs">
        <Field label="key">{npub}</Field>
        {specs.length > 0 && (
          <Field label="publishing">{`since ${new Date(oldest * 1000).toISOString().slice(0, 10)}`}</Field>
        )}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
        <CopyButton value={npub} label="Copy npub" title={npub} />
        <FeedLink to={authorRssPath(npub)}>RSS</FeedLink>
        <FeedLink to={authorAtomPath(npub)}>Atom</FeedLink>
      </div>
    </header>
  );
};

export default function AuthorRoute({ loaderData }: Route.ComponentProps) {
  const { pubkey, npub, author, specs } = loaderData;

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <Masthead pubkey={pubkey} npub={npub} author={author} specs={specs} />

        <section className="mt-14">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
            {shelf(specs.length)}
          </h2>
          {specs.length === 0 ? (
            <p className="mt-6 border-t border-rule pt-6 font-serif text-muted">
              Nothing signed by this key has reached the relays this server reads. A document
              published elsewhere appears here as soon as one of them holds it.
            </p>
          ) : (
            <ul className="mt-6">
              {specs.map((spec) => (
                // Every row here is signed by the same key, so the mark beside each
                // one would say what the page already says at the top.
                <SpecRow key={spec.path} spec={spec} avatar={false} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
