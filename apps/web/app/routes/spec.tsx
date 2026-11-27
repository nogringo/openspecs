import type { MarkdownHeading } from "@openspecs/markdown";
import {
  authorPath,
  parsePubkey,
  resolveNip05,
  specPath,
  toCoordinate,
  toNpub,
} from "@openspecs/nostr";
import { useEffect, useRef, useState } from "react";
import { data, Link, redirect } from "react-router";
import { AnnotatedDoc } from "~/components/annotated-doc";
import { AuthorAvatar } from "~/components/author-avatar";
import { CHROME } from "~/components/chrome";
import { COPIES_ID, Copies } from "~/components/copies";
import { Discussion } from "~/components/discussion/discussion";
import { LikeButton } from "~/components/discussion/like-button";
import { EditLink } from "~/components/editor/edit-link";
import { Withdraw } from "~/components/editor/withdraw";
import { ErrorPage } from "~/components/error-page";
import { BlockedNotice } from "~/components/moderation/blocked-notice";
import { More } from "~/components/moderation/more";
import { Shell } from "~/components/shell";
import { SpecTags } from "~/components/spec-tags";
import { hidesSpec, unblock, useBlocked } from "~/lib/blocked";
import { keyTextColor } from "~/lib/color";
import { type KnownCopies, useCopies } from "~/lib/copies";
import { loadCopies } from "~/lib/copies.server";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { useLiveRevision } from "~/lib/live-revision";
import { publicOrigin } from "~/lib/origin.server";
import { DISCUSSION_ID, oembedPath, ogImagePath, specForkPath } from "~/lib/paths";
import type { LinkPreview } from "~/lib/preview";
import { loadLinkPreviews } from "~/lib/preview.server";
import { type Author, type Authors, authorName, shortNpub } from "~/lib/profile";
import { loadAuthor, loadAuthors } from "~/lib/profile.server";
import { discussionRelays, rebroadcastRelays } from "~/lib/relays.server";
import type { SpecPage } from "~/lib/spec-page";
import { loadSpec } from "~/lib/specs.server";
import type { Route } from "./+types/spec";

export async function loader({ params, request }: Route.LoaderArgs) {
  // A NIP-05 address is a name a domain owner can reassign, so it addresses the
  // document but never names it: it is resolved once, then redirected away from.
  const pubkey = parsePubkey(params.author) ?? (await resolveNip05(params.author))?.pubkey ?? null;
  if (pubkey === null) {
    throw data({ missing: "address" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  // One document, one URL: a hex key or an nprofile addresses the same author.
  const path = specPath({ pubkey, identifier: params.identifier });
  if (params.author !== toNpub(pubkey)) throw redirect(path, 301);

  const cached = await loadSpec(pubkey, params.identifier);
  if (cached === null) {
    throw data({ missing: "document" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }
  // Built per request rather than cached with the document: one document can be
  // served under more than one origin, and only this one is canonical.
  const origin = publicOrigin(request);
  const spec = cached.page;
  const [relays, discussion, previews, author, { copies, copyAuthors }] = await Promise.all([
    rebroadcastRelays(pubkey),
    discussionRelays(pubkey),
    loadLinkPreviews(spec.links),
    loadAuthor(pubkey),
    loadCopies(cached).then(async (copies) => ({
      copies,
      copyAuthors:
        copies === null || copies.copies.length === 0
          ? {}
          : await loadAuthors(copies.copies.map((copy) => copy.pubkey)),
    })),
  ]);
  return {
    spec,
    relays,
    // Where the conversation about this document is, beyond the relays every
    // client of this kind reads. Resolved here because this cache is warm.
    discussion,
    previews,
    author,
    copies,
    copyAuthors,
    origin,
    canonical: `${origin}${path}`,
    ogImage: `${origin}${ogImagePath(toNpub(pubkey), spec.identifier)}`,
  };
}

/**
 * The headers a thrown response carries only reach this point through
 * `errorHeaders`, and only because this route owns its own error boundary.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? PAGE_HEADERS;
}

const asIso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/**
 * No `publisher`, and no `og:image` until the images of lot 3 exist. This site
 * does not publish these documents, their authors do, and claiming otherwise in
 * structured data would be the one lie the whole design is built to avoid.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData)
    return [{ title: "Not found | Open Specs" }, { name: "robots", content: "noindex" }];

  const { spec, author, canonical, ogImage, origin } = loaderData;
  const title = `${spec.title} | Open Specs`;

  return [
    { title },
    { name: "description", content: spec.summary },
    { tagName: "link", rel: "canonical", href: canonical },

    { property: "og:type", content: "article" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: spec.title },
    { property: "og:description", content: spec.summary },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: spec.title },
    { property: "article:published_time", content: asIso(spec.publishedAt) },
    { property: "article:modified_time", content: asIso(spec.revisedAt) },
    ...spec.topics.map((topic) => ({ property: "article:tag", content: topic })),

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: spec.title },
    { name: "twitter:description", content: spec.summary },
    { name: "twitter:image", content: ogImage },
    {
      tagName: "link",
      rel: "alternate",
      type: "application/json+oembed",
      title: spec.title,
      href: `${origin}${oembedPath(canonical)}`,
    },

    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: spec.title,
        description: spec.summary,
        url: canonical,
        mainEntityOfPage: canonical,
        datePublished: asIso(spec.publishedAt),
        dateModified: asIso(spec.revisedAt),
        // The key stays the identifier whatever the author calls themselves today.
        author: {
          "@type": "Person",
          name: author?.name || spec.npub,
          ...(author?.name && { alternateName: spec.npub }),
          ...(author?.picture && { image: author.picture }),
          identifier: `nostr:${spec.npub}`,
        },
        ...(spec.topics.length > 0 && { keywords: spec.topics.join(", ") }),
      },
    },
  ];
}

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

const shorten = (value: string, head: number, tail: number): string =>
  value.length <= head + tail ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;

const listedHeadings = (headings: MarkdownHeading[]) =>
  headings.filter((heading) => heading.depth <= 3);

const ContentsList = ({
  headings,
  copyCount,
  onPick,
}: {
  headings: MarkdownHeading[];
  copyCount: number;
  /** Set where the list is tapped rather than clicked: taller targets, and the width for whole headings. */
  onPick?: () => void;
}) => (
  <ul
    className={`font-mono leading-snug ${onPick ? "space-y-0.5 text-sm [&_a]:py-1.5" : "space-y-2 text-xs"}`}
  >
    {listedHeadings(headings).map((heading) => (
      <li key={heading.id} style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 0.75}rem` }}>
        <a
          href={`#${heading.id}`}
          title={heading.text}
          onClick={onPick}
          className={`${onPick ? "block" : "line-clamp-2"} text-muted hover:text-ink`}
        >
          {heading.text}
        </a>
      </li>
    ))}
    {/* Part of the page rather than an appendix to it: what was said about a
        specification is one of the things a reader comes here to find. */}
    <li className="mt-4 border-t border-rule pt-3">
      {copyCount > 0 && (
        <a href={`#${COPIES_ID}`} onClick={onPick} className="mb-2 block text-muted hover:text-ink">
          Other copies
        </a>
      )}
      <a href={`#${DISCUSSION_ID}`} onClick={onPick} className="block text-muted hover:text-ink">
        Discussion
      </a>
    </li>
  </ul>
);

const Contents = ({ headings, copyCount }: { headings: MarkdownHeading[]; copyCount: number }) => (
  <nav
    aria-label="Contents"
    /* The negative margin and the padding are one pair: scrolling this rail
       makes it clip on both axes, and a link's focus ring sits outside the link. */
    className="hidden lg:-mx-1.5 lg:sticky lg:top-10 lg:block lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:px-1.5"
  >
    <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">Contents</p>
    <div className="mt-3">
      <ContentsList headings={headings} copyCount={copyCount} />
    </div>
  </nav>
);

const shut = (details: HTMLDetailsElement | null) => {
  if (details) details.open = false;
};

/**
 * The rail folded into a bar pinned over the column, where there is no room
 * beside the text. A `details`, so it opens without any script; the list lies
 * over the text rather than pushing it, so opening it mid-document moves nothing.
 */
const ContentsBar = ({
  headings,
  copyCount,
}: {
  headings: MarkdownHeading[];
  copyCount: number;
}) => {
  const bar = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => shut(bar.current);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) shut(bar.current);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <nav aria-label="Contents" className="sticky top-0 z-10 -mx-6 -mt-4 mb-6 lg:hidden">
      <details
        ref={bar}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group relative border-b border-rule bg-paper"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-3 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted [&::-webkit-details-marker]:hidden">
          Contents
          <span aria-hidden="true" className="text-sm leading-none group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="absolute inset-x-0 top-full max-h-[60dvh] overflow-y-auto border-b border-rule bg-paper px-6 pt-1 pb-5 shadow-sm">
          <ContentsList headings={headings} copyCount={copyCount} onPick={close} />
        </div>
      </details>
    </nav>
  );
};

const Masthead = ({
  spec,
  author,
  canonical,
  relays,
  copyCount,
  spotCount,
}: {
  spec: SpecPage;
  author: Author | null;
  canonical: string;
  relays: string[];
  copyCount: number;
  spotCount: number;
}) => (
  <header>
    <h1 className="font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
      {spec.title}
    </h1>
    {/* A derived summary is the opening paragraph already sitting below, so only a written one is shown. */}
    {!spec.summaryIsDerived && spec.summary !== "" && (
      <p className="mt-4 max-w-2xl font-serif text-lg leading-relaxed text-muted">{spec.summary}</p>
    )}

    <div className="mt-5 max-w-2xl">
      <SpecTags status={spec.status} kinds={spec.kinds} topics={spec.topics} linked />
    </div>

    <div className="mt-7 flex flex-wrap items-center gap-x-10 gap-y-4">
      <Byline spec={spec} author={author} copyCount={copyCount} spotCount={spotCount} />
      <Actions spec={spec} canonical={canonical} relays={relays} />
    </div>
  </header>
);

const Byline = ({
  spec,
  author,
  copyCount,
  spotCount,
}: {
  spec: SpecPage;
  author: Author | null;
  copyCount: number;
  spotCount: number;
}) => (
  <div className="flex min-w-0 items-center gap-3">
    <Link
      to={authorPath(spec.pubkey)}
      title={`Everything signed by ${spec.npub}`}
      className="shrink-0"
    >
      <AuthorAvatar pubkey={spec.pubkey} picture={author?.picture ?? null} size={36} />
    </Link>
    <div className="min-w-0 font-mono text-xs">
      {/* With no name published the key is written here itself, as it is
          everywhere else on the site. */}
      <p title={author?.name || spec.npub} className="truncate text-sm font-medium">
        <Link
          to={authorPath(spec.pubkey)}
          style={{ color: keyTextColor(spec.pubkey) }}
          className="hover:underline"
        >
          {authorName(author, spec.npub)}
        </Link>
      </p>
      <p className="mt-0.5 text-muted">
        <span className="whitespace-nowrap">
          published <time dateTime={asIso(spec.publishedAt)}>{asDate(spec.publishedAt)}</time>
        </span>
        {spec.revisedAt > spec.publishedAt && (
          <>
            ,{" "}
            <span className="whitespace-nowrap">
              revised <time dateTime={asIso(spec.revisedAt)}>{asDate(spec.revisedAt)}</time>
            </span>
          </>
        )}
        {/* Growing sideways rather than down: when the server could not wait for
            it, this arrives after the page is on screen. */}
        {copyCount > 0 && (
          <a
            href={`#${COPIES_ID}`}
            title="Other keys have written this document too"
            className="ml-3 underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-current"
          >
            {copyCount} other {copyCount === 1 ? "copy" : "copies"}
            {spotCount > 0 &&
              `, differing in ${spotCount} ${spotCount === 1 ? "place" : "places"} below`}
          </a>
        )}
      </p>
      {spec.forkedFrom.map((source) => (
        <p key={source.type === "spec" ? source.path : source.url} className="mt-0.5 text-muted">
          forked from{" "}
          {source.type === "spec" ? (
            <>
              <Link
                to={source.path}
                className="text-ink underline decoration-rule underline-offset-2 hover:decoration-current"
              >
                {source.identifier}
              </Link>{" "}
              {shorten(source.npub, 10, 6)}
            </>
          ) : (
            <a
              href={source.url}
              rel="nofollow noopener noreferrer"
              className="text-ink underline decoration-rule underline-offset-2 hover:decoration-current"
            >
              {source.host}
            </a>
          )}
        </p>
      ))}
    </div>
  </div>
);

const Actions = ({
  spec,
  canonical,
  relays,
}: {
  spec: SpecPage;
  canonical: string;
  relays: string[];
}) => (
  <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
    <LikeButton coordinate={toCoordinate(spec)} specEventId={spec.eventId} pubkey={spec.pubkey} />
    {/* Beside the reaction, because those two are what a reader does with the
          document itself. Everything else it has to offer is one word further on.

          Drawn on the server for everybody, with no session gating: the page it
          leads to offers the ways in, and a control appearing a tick after paint
          for the already connected would hide this from the readers most likely
          to have never signed anything. */}
    <Link
      to={specForkPath(spec.npub, spec.identifier)}
      title="Write your own from this one"
      className={CHROME}
    >
      Fork
    </Link>
    {/* Before the menu, though both arrive a tick after paint and push it
          along when they do. A named action sitting after a catch-all reads as
          something that fell out of it, and that misreading is on the page for
          as long as an author is looking at their own document. */}
    <EditLink pubkey={spec.pubkey} npub={spec.npub} identifier={spec.identifier} />
    <Withdraw pubkey={spec.pubkey} identifier={spec.identifier} />
    <More
      target={{
        kind: "document",
        pubkey: spec.pubkey,
        id: spec.eventId,
        coordinate: toCoordinate(spec),
        identifier: spec.identifier,
        canonical,
        relays,
      }}
    />
  </div>
);

const CitedLinks = ({ previews }: { previews: LinkPreview[] }) => (
  <section className="mt-16 border-t border-rule pt-8">
    <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
      Cited links
    </h2>
    <ul className="mt-5 grid gap-3 sm:grid-cols-2">
      {previews.map((preview) => (
        <li key={preview.url}>
          <a
            href={preview.url}
            rel="nofollow noopener noreferrer"
            className="group block h-full rounded-sm border border-rule p-4 hover:border-muted"
          >
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
              {preview.host}
            </p>
            <p className="mt-2 line-clamp-2 font-mono text-sm leading-snug group-hover:underline">
              {preview.title}
            </p>
            {preview.description !== "" && (
              <p className="mt-2 line-clamp-3 font-serif text-sm leading-snug text-muted">
                {preview.description}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  </section>
);

/**
 * Offered above the document rather than swapped into it, and drawn dashed like
 * everything on this site that is available rather than settled.
 *
 * A revision with nothing in it is an author withdrawing their document, so it
 * is said in those words: "a newer revision" over a blank record reads as an
 * edit somebody would want to see. Nothing is offered alongside it either, since
 * what there is to show is an empty page, and the sentence already is that.
 */
const Fresher = ({ fresher, onShow }: { fresher: SpecPage; onShow: () => void }) => (
  <div className="mb-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-dashed border-rule px-4 py-3">
    <p className="font-serif text-[0.9375rem] leading-snug text-muted">
      {fresher.isEmpty
        ? `Its author withdrew this document on ${asDate(fresher.revisedAt)}. What is below is the copy this page was served.`
        : `Its author published a newer revision on ${asDate(fresher.revisedAt)}.`}
    </p>
    {!fresher.isEmpty && (
      <button
        type="button"
        onClick={onShow}
        className="rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink"
      >
        Show it
      </button>
    )}
  </div>
);

const Article = ({
  served,
  author,
  previews,
  canonical,
  relays,
  discussion,
  known,
  copyAuthors,
}: {
  served: SpecPage;
  author: Author | null;
  previews: LinkPreview[];
  canonical: string;
  relays: string[];
  discussion: string[];
  known: KnownCopies | null;
  copyAuthors: Authors;
}) => {
  const { shown, fresher, show } = useLiveRevision(served);
  // On the shown revision, not the served one: the marks sit on the text on screen.
  const { copies: every, spots, standings } = useCopies(shown, known);

  const blocked = useBlocked();
  const [shownAnyway, setShownAnyway] = useState(false);
  const copies = every.filter((copy) => !hidesSpec(blocked, copy));

  // A preview was fetched for the links the served revision cited. One that no
  // longer appears in the document has no business under it.
  const cited = previews.filter((preview) => shown.links.includes(preview.url));

  // The title goes with the rest: it is the author's text too. What stays is
  // the address, which is the reader's own way of knowing where they are.
  const byAuthor = blocked.pubkeys.has(served.pubkey);
  const byDocument = blocked.coordinates.has(toCoordinate(served));
  if ((byAuthor || byDocument) && !shownAnyway) {
    return (
      <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <BlockedNotice
          line={
            byAuthor
              ? "You blocked the account that signed this document."
              : "You blocked this document."
          }
          detail={`${shortNpub(served.npub)} / ${served.identifier}`}
          onUnblock={() => {
            if (byAuthor) unblock({ type: "p", value: served.pubkey });
            if (byDocument) unblock({ type: "a", value: toCoordinate(served) });
          }}
          onShow={() => setShownAnyway(true)}
        />
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      {fresher !== null && <Fresher fresher={fresher} onShow={show} />}

      <Masthead
        spec={shown}
        author={author}
        canonical={canonical}
        relays={relays}
        copyCount={copies.length}
        spotCount={spots.length}
      />

      <div className="mt-10 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
        <Contents headings={shown.headings} copyCount={copies.length} />
        <div className="max-w-[40rem]">
          {listedHeadings(shown.headings).length >= 2 && (
            <ContentsBar headings={shown.headings} copyCount={copies.length} />
          )}
          {shown.isEmpty ? (
            <p className="font-serif text-lg text-muted">
              No text yet. Its author published this record without a body.
            </p>
          ) : (
            // Sanitized by the pipeline that produced it, whether that ran on
            // this server or in this browser: both call `renderMarkdown`.
            // Keyed on the revision: the marks and panels are measured against
            // this exact markup and must not outlive it.
            <AnnotatedDoc key={shown.eventId} html={shown.html} spots={spots} known={copyAuthors} />
          )}
          {cited.length > 0 && <CitedLinks previews={cited} />}
          <Copies
            copies={copies}
            known={copyAuthors}
            standings={standings}
            from={{ npub: shown.npub, identifier: shown.identifier }}
          />
          <Discussion
            coordinate={toCoordinate(shown)}
            specEventId={shown.eventId}
            pubkey={shown.pubkey}
            canonical={canonical}
            relays={discussion}
            revisedAt={shown.revisedAt > shown.publishedAt ? shown.revisedAt : null}
          />
        </div>
      </div>
    </article>
  );
};

export default function Spec({ loaderData }: Route.ComponentProps) {
  const { spec, author, previews, canonical, relays, discussion, copies, copyAuthors } = loaderData;

  return (
    <Shell>
      {/* Keyed on the revision, so walking from one document to the next never
          leaves the previous one's text on screen for a frame: React Router
          renders the same component for both, and the state below would outlive
          the document it belongs to. */}
      <Article
        key={spec.eventId}
        served={spec}
        author={author}
        previews={previews}
        canonical={canonical}
        relays={relays}
        discussion={discussion}
        known={copies}
        copyAuthors={copyAuthors}
      />
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
