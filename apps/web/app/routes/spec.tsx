import type { MarkdownHeading } from "@openspecs/markdown";
import { parsePubkey, resolveNip05, specPath, toNpub } from "@openspecs/nostr";
import { data, redirect } from "react-router";
import { CopyButton } from "~/components/copy-button";
import { ErrorPage } from "~/components/error-page";
import { KeyMark } from "~/components/key-mark";
import { Rebroadcast } from "~/components/rebroadcast";
import { Shell } from "~/components/shell";
import { SpecTags } from "~/components/spec-tags";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { publicOrigin } from "~/lib/origin.server";
import { eventPath, oembedPath, ogImagePath } from "~/lib/paths";
import type { LinkPreview } from "~/lib/preview";
import { loadLinkPreviews } from "~/lib/preview.server";
import { rebroadcastRelays } from "~/lib/relays.server";
import { loadSpec, type SpecPage } from "~/lib/specs.server";
import type { Route } from "./+types/spec";

export async function loader({ params, request }: Route.LoaderArgs) {
  // A NIP-05 address is a name a domain owner can reassign, so it addresses the
  // document but never names it: it is resolved once, then redirected away from.
  const pubkey = parsePubkey(params.author) ?? (await resolveNip05(params.author))?.pubkey ?? null;
  if (pubkey === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  // One document, one URL: a hex key or an nprofile addresses the same author.
  const path = specPath({ pubkey, identifier: params.identifier });
  if (params.author !== toNpub(pubkey)) throw redirect(path, 301);

  const cached = await loadSpec(pubkey, params.identifier);
  if (cached === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  // Built per request rather than cached with the document: one document can be
  // served under more than one origin, and only this one is canonical.
  const origin = publicOrigin(request);
  const spec = cached.page;
  return {
    spec,
    relays: await rebroadcastRelays(pubkey),
    previews: await loadLinkPreviews(spec.links),
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

  const { spec, canonical, ogImage, origin } = loaderData;
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
        author: { "@type": "Person", name: spec.npub, identifier: `nostr:${spec.npub}` },
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

const Contents = ({ headings }: { headings: MarkdownHeading[] }) => (
  <nav
    aria-label="Contents"
    className="hidden lg:sticky lg:top-10 lg:block lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto"
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
    </ul>
  </nav>
);

const Masthead = ({
  spec,
  canonical,
  relays,
}: {
  spec: SpecPage;
  canonical: string;
  relays: string[];
}) => (
  <header>
    <p className="font-mono text-xs tracking-wide text-muted">
      {spec.kind}:{spec.identifier}
    </p>
    <h1 className="mt-4 font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
      {spec.title}
    </h1>
    {/* A derived summary is the opening paragraph already sitting below, so only a written one is shown. */}
    {!spec.summaryIsDerived && spec.summary !== "" && (
      <p className="mt-4 max-w-2xl font-serif text-lg leading-relaxed text-muted">{spec.summary}</p>
    )}

    <div className="mt-6">
      <SpecTags status={spec.status} kinds={spec.kinds} topics={spec.topics} linked />
    </div>

    <div className="mt-8 inline-flex max-w-full items-start gap-4 rounded-sm border border-rule px-4 py-3.5">
      <KeyMark pubkey={spec.pubkey} />
      <dl className="min-w-0 space-y-1 font-mono text-xs">
        <Field label="signed by">{shorten(spec.npub, 10, 6)}</Field>
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

export default function Spec({ loaderData }: Route.ComponentProps) {
  const { spec, previews, canonical, relays } = loaderData;

  return (
    <Shell>
      <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <Masthead spec={spec} canonical={canonical} relays={relays} />

        <div className="mt-14 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <Contents headings={spec.headings} />
          <div className="max-w-[40rem]">
            {spec.isEmpty ? (
              <p className="font-serif text-lg text-muted">
                No text yet. Its author published this record without a body.
              </p>
            ) : (
              // Sanitized in the loader, by the same pipeline that produced the markup.
              <div
                className="doc"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: server rendered Markdown
                dangerouslySetInnerHTML={{ __html: spec.html }}
              />
            )}
            {previews.length > 0 && <CitedLinks previews={previews} />}
          </div>
        </div>
      </article>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
