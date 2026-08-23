import type { MarkdownHeading } from "@openspecs/markdown";
import {
  authorPath,
  parsePubkey,
  resolveNip05,
  specPath,
  toCoordinate,
  toNpub,
} from "@openspecs/nostr";
import { data, Link, redirect } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { CopyButton } from "~/components/copy-button";
import { DISCUSSION_ID, Discussion } from "~/components/discussion/discussion";
import { EditLink } from "~/components/editor/edit-link";
import { Withdraw } from "~/components/editor/withdraw";
import { ErrorPage } from "~/components/error-page";
import { Rebroadcast } from "~/components/rebroadcast";
import { Shell } from "~/components/shell";
import { SpecTags } from "~/components/spec-tags";
import { VARIANTS_ID, Variants } from "~/components/variants";
import { keyTextColor } from "~/lib/color";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { useLiveRevision } from "~/lib/live-revision";
import { publicOrigin } from "~/lib/origin.server";
import { eventPath, oembedPath, ogImagePath } from "~/lib/paths";
import type { LinkPreview } from "~/lib/preview";
import { loadLinkPreviews } from "~/lib/preview.server";
import type { Author } from "~/lib/profile";
import { loadAuthor } from "~/lib/profile.server";
import { discussionRelays, rebroadcastRelays } from "~/lib/relays.server";
import type { SpecPage } from "~/lib/spec-page";
import { loadSpec } from "~/lib/specs.server";
import { useVariants } from "~/lib/variants";
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
  const [relays, discussion, previews, author] = await Promise.all([
    rebroadcastRelays(pubkey),
    discussionRelays(pubkey),
    loadLinkPreviews(spec.links),
    loadAuthor(pubkey),
  ]);
  return {
    spec,
    relays,
    // Where the conversation about this document is, beyond the relays every
    // client of this kind reads. Resolved here because this cache is warm.
    discussion,
    previews,
    author,
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

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-20 shrink-0 text-muted">{label}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </div>
);

const Contents = ({
  headings,
  variantCount,
}: {
  headings: MarkdownHeading[];
  variantCount: number;
}) => (
  <nav
    aria-label="Contents"
    /* The negative margin and the padding are one pair: scrolling this rail
       makes it clip on both axes, and a link's focus ring sits outside the link. */
    className="hidden lg:-mx-1.5 lg:sticky lg:top-10 lg:block lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:px-1.5"
  >
    <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">Contents</p>
    <ul className="mt-3 space-y-2 font-mono text-xs leading-snug">
      {headings
        .filter((heading) => heading.depth <= 3)
        .map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 0.75}rem` }}
          >
            <a
              href={`#${heading.id}`}
              title={heading.text}
              className="line-clamp-2 text-muted hover:text-ink"
            >
              {heading.text}
            </a>
          </li>
        ))}
      {/* Part of the page rather than an appendix to it: what was said about a
          specification is one of the things a reader comes here to find. */}
      <li className="mt-4 border-t border-rule pt-3">
        {variantCount > 0 && (
          <a href={`#${VARIANTS_ID}`} className="mb-2 block text-muted hover:text-ink">
            Under this name
          </a>
        )}
        <a href={`#${DISCUSSION_ID}`} className="text-muted hover:text-ink">
          Discussion
        </a>
      </li>
    </ul>
  </nav>
);

const Masthead = ({
  spec,
  author,
  canonical,
  relays,
  variantCount,
}: {
  spec: SpecPage;
  author: Author | null;
  canonical: string;
  relays: string[];
  variantCount: number;
}) => (
  <header>
    <p className="font-mono text-xs tracking-wide text-muted">
      {spec.kind}:{spec.identifier}
      {/* Growing sideways rather than down: this arrives after the page is on
          screen, and text under the reader's eye must not move for it. */}
      {variantCount > 0 && (
        <a
          href={`#${VARIANTS_ID}`}
          title={`Other documents published as ${spec.identifier}`}
          className="ml-3 underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-current"
        >
          also under {variantCount} other {variantCount === 1 ? "key" : "keys"}
        </a>
      )}
    </p>
    <h1 className="mt-4 font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
      {spec.title}
    </h1>
    {/* A derived summary is the opening paragraph already sitting below, so only a written one is shown. */}
    {!spec.summaryIsDerived && spec.summary !== "" && (
      <p className="mt-4 max-w-2xl font-serif text-lg leading-relaxed text-muted">{spec.summary}</p>
    )}

    <div className="mt-6 max-w-2xl">
      <SpecTags status={spec.status} kinds={spec.kinds} topics={spec.topics} linked />
    </div>

    <div className="mt-8 inline-flex max-w-full items-start gap-4 rounded-sm border border-rule px-4 py-3.5">
      <Link to={authorPath(spec.pubkey)} title={`Everything signed by ${spec.npub}`}>
        <AuthorAvatar pubkey={spec.pubkey} picture={author?.picture ?? null} />
      </Link>
      <div className="min-w-0">
        {/* A name is what a key says about itself, so the key it belongs to stays under it. */}
        {author !== null && author.name !== "" && (
          <p title={author.name} className="mb-1.5 truncate font-mono text-sm font-medium">
            <Link
              to={authorPath(spec.pubkey)}
              style={{ color: keyTextColor(spec.pubkey) }}
              className="hover:underline"
            >
              {author.name}
            </Link>
          </p>
        )}
        <dl className="min-w-0 space-y-1 font-mono text-xs">
          <Field label="signed by">
            <Link
              to={authorPath(spec.pubkey)}
              className="underline decoration-rule underline-offset-2 hover:decoration-current"
            >
              {shorten(spec.npub, 10, 6)}
            </Link>
          </Field>
          <Field label="published">{asDate(spec.publishedAt)}</Field>
          {spec.revisedAt > spec.publishedAt && (
            <Field label="revised">{asDate(spec.revisedAt)}</Field>
          )}
          <Field label="event">
            <a
              href={eventPath(spec.npub, spec.identifier)}
              className="underline decoration-rule underline-offset-2 hover:decoration-current"
            >
              {shorten(spec.eventId, 10, 4)}
            </a>
          </Field>
        </dl>
      </div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      <CopyButton value={canonical} label="Copy link" title={canonical} />
      <CopyButton
        value={spec.naddr}
        label="Copy naddr"
        title="The document's Nostr address, for any client"
      />
      <CopyButton
        value={() => fetch(eventPath(spec.npub, spec.identifier)).then((event) => event.text())}
        label="Copy event"
        title="The signed event, exactly as the relays serve it"
      />
      <Rebroadcast eventUrl={eventPath(spec.npub, spec.identifier)} relays={relays} />
      <EditLink pubkey={spec.pubkey} npub={spec.npub} identifier={spec.identifier} />
      <Withdraw pubkey={spec.pubkey} identifier={spec.identifier} />
    </div>
  </header>
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
}: {
  served: SpecPage;
  author: Author | null;
  previews: LinkPreview[];
  canonical: string;
  relays: string[];
  discussion: string[];
}) => {
  const { shown, fresher, show } = useLiveRevision(served);
  const variants = useVariants(served);

  // A preview was fetched for the links the served revision cited. One that no
  // longer appears in the document has no business under it.
  const cited = previews.filter((preview) => shown.links.includes(preview.url));

  return (
    <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      {fresher !== null && <Fresher fresher={fresher} onShow={show} />}

      <Masthead
        spec={shown}
        author={author}
        canonical={canonical}
        relays={relays}
        variantCount={variants.length}
      />

      <div className="mt-14 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
        <Contents headings={shown.headings} variantCount={variants.length} />
        <div className="max-w-[40rem]">
          {shown.isEmpty ? (
            <p className="font-serif text-lg text-muted">
              No text yet. Its author published this record without a body.
            </p>
          ) : (
            // Sanitized by the pipeline that produced it, whether that ran on
            // this server or in this browser: both call `renderMarkdown`.
            <div
              className="doc"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered Markdown
              dangerouslySetInnerHTML={{ __html: shown.html }}
            />
          )}
          {cited.length > 0 && <CitedLinks previews={cited} />}
          <Variants variants={variants} from={{ npub: shown.npub, identifier: shown.identifier }} />
          <Discussion
            coordinate={toCoordinate(shown)}
            specEventId={shown.eventId}
            pubkey={shown.pubkey}
            relays={discussion}
            revisedAt={shown.revisedAt > shown.publishedAt ? shown.revisedAt : null}
          />
        </div>
      </div>
    </article>
  );
};

export default function Spec({ loaderData }: Route.ComponentProps) {
  const { spec, author, previews, canonical, relays, discussion } = loaderData;

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
      />
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
