import {
  authorPath,
  checkNip05,
  nip05Label,
  parseNip05Address,
  parsePubkey,
  parseSpecAddress,
  resolveNip05,
  specPath,
  toNpub,
} from "@openspecs/nostr";
import { useState } from "react";
import { data, redirect } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { CopyButton } from "~/components/copy-button";
import { ErrorPage } from "~/components/error-page";
import { BlockedNotice } from "~/components/moderation/blocked-notice";
import { Pagination } from "~/components/pagination";
import { Shell } from "~/components/shell";
import { SpecRow } from "~/components/spec-row";
import { unblock, useBlocked, useShown } from "~/lib/blocked";
import { withDeadline } from "~/lib/cache.server";
import { keyTextColor } from "~/lib/color";
import { parsePage } from "~/lib/filter";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { likeKey, useLikes } from "~/lib/likes";
import { publicOrigin } from "~/lib/origin.server";
import { pageOf } from "~/lib/pagination";
import { authorAtomPath, authorOgImagePath, authorPagePath, authorRssPath } from "~/lib/paths";
import { type Author, authorDescription, authorName } from "~/lib/profile";
import { loadAuthor } from "~/lib/profile.server";
import { LISTING_WINDOW, loadAuthorSpecs } from "~/lib/specs.server";
import type { Route } from "./+types/author";

/** Short enough that the whole page is one glance down the shelf. */
const PAGE_SIZE = 20;

/** Shorter than the profile's own: a name is the page, an address is a word on it. */
const NIP05_DEADLINE_MS = 600;

const NO = Promise.resolve(false);

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

  const url = new URL(request.url);
  // One author, one URL: a hex key, an nprofile and a NIP-05 address all name
  // the same person, and only the npub is the name that cannot be taken away.
  // The search rides along, so a link deep into the shelf lands where it aimed.
  const npub = toNpub(pubkey);
  if (params.author !== npub) throw redirect(`${authorPath(pubkey)}${url.search}`, 301);

  const [author, shelf] = await Promise.all([loadAuthor(pubkey), loadAuthorSpecs(pubkey)]);
  // A key with neither a document nor a profile is not a page. Relays hold
  // millions of them, and every one would be an empty page to be crawled. The
  // whole shelf is what decides it, never the page of it being read.
  if (author === null && shelf.length === 0) {
    throw data({ missing: "author" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  // Asked here rather than in the browser: the answer is the same for every
  // reader, and a domain that serves this without the CORS header NIP-05 asks
  // for would be unaskable from a page. Short, since it decides one word, and
  // the request that outran it still fills the cache the next reader reads.
  const confirmed = await withDeadline(
    author?.nip05 ? checkNip05(pubkey, author.nip05).then((check) => check === "confirmed") : NO,
    false,
    NIP05_DEADLINE_MS,
  );

  const { items, page, pages, total } = pageOf(shelf, parsePage(url.searchParams), PAGE_SIZE);
  // Read off the whole shelf: a page of it says when this author last wrote,
  // not when they started.
  const oldest = shelf.reduce(
    (first, spec) => Math.min(first, spec.publishedAt),
    Number.POSITIVE_INFINITY,
  );

  const origin = publicOrigin(request);
  const pageUrl = (n: number) => `${origin}${authorPagePath(npub, n)}`;
  return {
    pubkey,
    npub,
    author,
    confirmed,
    specs: items,
    page,
    pages,
    total,
    capped: total >= LISTING_WINDOW,
    oldest,
    origin,
    // The clamped page, so a number past the end still points at a page there is.
    canonical: pageUrl(page),
    previous: page > 1 ? pageUrl(page - 1) : null,
    next: page < pages ? pageUrl(page + 1) : null,
    ogImage: `${origin}${authorOgImagePath(npub)}`,
  };
}

export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? PAGE_HEADERS;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Author | Open Specs" }];

  const { author, npub, total, page, canonical, previous, next, origin, ogImage } = loaderData;
  const name = authorName(author, npub);
  const description = authorDescription(author, npub, total);
  // Every page of a shelf is a different set of documents, so each one says
  // which it is rather than sitting in a result list under the same title.
  const title = page === 1 ? name : `${name}, page ${page}`;

  return [
    { title: `${title} | Open Specs` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    // Kept so a crawler walks the whole shelf rather than the first page of it.
    ...(previous === null ? [] : [{ tagName: "link", rel: "prev", href: previous }]),
    ...(next === null ? [] : [{ tagName: "link", rel: "next", href: next }]),
    // An author with nothing published is a page for whoever typed the key, not
    // one for an index: there is nothing on it to find.
    ...(total === 0 ? [{ name: "robots", content: "noindex, follow" }] : []),

    { property: "og:type", content: "profile" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
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
          // Not `url`, which is this page: `sameAs` is for the same person elsewhere.
          ...(author?.website && { sameAs: [author.website] }),
        },
      },
    },
  ];
}

/** A shelf that fills the window may be hiding more, so it is described rather than counted. */
const shelf = (count: number, capped: boolean): string => {
  if (count === 0) return "No specification";
  if (capped) return `The newest ${count} specifications`;
  return count === 1 ? "One specification" : `${count} specifications`;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-20 shrink-0 text-muted">{label}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </div>
);

/** The scheme and the trailing slash are the browser's business, not the reader's. */
const readable = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

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
  confirmed,
  total,
  oldest,
}: {
  pubkey: string;
  npub: string;
  author: Author | null;
  /** The domain in the address answers with this key. */
  confirmed: boolean;
  total: number;
  oldest: number;
}) => (
  <header>
    <div className="flex items-start gap-5">
      <AuthorAvatar pubkey={pubkey} picture={author?.picture ?? null} size={72} />
      <div className="min-w-0">
        <h1
          style={{ color: keyTextColor(pubkey) }}
          className="break-all font-mono text-2xl font-medium tracking-tight sm:text-3xl"
        >
          {authorName(author, npub)}
        </h1>
        {/* A claim the author makes, and beside it whether the domain it names
            backs it. NIP-05 is careful that this identifies rather than
            vouches: a domain saying yes says the two are the same account
            somewhere, and nothing about who that is. */}
        {author?.nip05 && (
          <p className="mt-2 break-all font-mono text-xs text-muted">
            {nip05Label(author.nip05)}
            {confirmed && (
              <span
                title={`${parseNip05Address(author.nip05)?.domain ?? "The domain"} answers with this key, so the address and the key are one account there.`}
                className="ml-2 whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.14em] text-signal-settled"
              >
                confirmed
              </span>
            )}
          </p>
        )}
      </div>
    </div>

    {author?.about && (
      <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted">{author.about}</p>
    )}

    <dl className="mt-8 min-w-0 space-y-1 font-mono text-xs">
      <Field label="key">{npub}</Field>
      {/* Somewhere the author sent a reader, so it is theirs rather than this
          site's: nofollow, and opened without a handle back onto this page. */}
      {author?.website && (
        <Field label="website">
          <a
            href={author.website}
            rel="noopener noreferrer nofollow"
            className="underline decoration-rule underline-offset-2 hover:decoration-current"
          >
            {readable(author.website)}
          </a>
        </Field>
      )}
      {total > 0 && (
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

export default function AuthorRoute({ loaderData }: Route.ComponentProps) {
  const { pubkey, npub, author, confirmed, page, pages, total, capped, oldest } = loaderData;
  const specs = useShown(loaderData.specs);
  const likes = useLikes(specs);
  const blocked = useBlocked();
  const [shownAnyway, setShownAnyway] = useState(false);

  // The name and the picture go with the rest: they are this key's words too.
  if (blocked.pubkeys.has(pubkey) && !shownAnyway) {
    return (
      <Shell>
        <main className="mx-auto max-w-5xl px-6 py-16">
          <BlockedNotice
            line="You blocked this account."
            detail={npub}
            onUnblock={() => unblock({ type: "p", value: pubkey })}
            onShow={() => setShownAnyway(true)}
          />
        </main>
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <Masthead
          pubkey={pubkey}
          npub={npub}
          author={author}
          confirmed={confirmed}
          total={total}
          oldest={oldest}
        />

        <section className="mt-14">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
            {shelf(total, capped)}
            {pages > 1 && <span className="text-rule">{` / page ${page} of ${pages}`}</span>}
          </h2>
          {total === 0 ? (
            <p className="mt-6 border-t border-rule pt-6 font-serif text-muted">
              Nothing signed by this key has reached the relays this server reads. A document
              published elsewhere appears here as soon as one of them holds it.
            </p>
          ) : (
            <>
              <ul className="mt-6">
                {specs.map((spec) => (
                  // Every row here is signed by the same key, so the mark beside each
                  // one would say what the page already says at the top.
                  <SpecRow
                    key={spec.path}
                    spec={spec}
                    avatar={false}
                    likes={likes[likeKey(spec)] ?? null}
                  />
                ))}
              </ul>
              <Pagination
                page={page}
                pages={pages}
                href={(n) => authorPagePath(npub, n)}
                label="Specifications by this key"
              />
            </>
          )}
        </section>
      </main>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
