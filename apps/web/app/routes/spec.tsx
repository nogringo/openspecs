import type { MarkdownHeading } from "@openspecs/markdown";
import { parsePubkey, specPath, toNpub } from "@openspecs/nostr";
import { data, isRouteErrorResponse, Link, redirect } from "react-router";
import { KeyMark } from "~/components/key-mark";
import { loadSpec, type SpecPage } from "~/lib/specs.server";
import type { Route } from "./+types/spec";

/**
 * A missing document must stay cacheable too: a crawler walking dead links would
 * otherwise put a relay query behind every one of them. Kept short, because the
 * document may be published a minute later.
 */
const NOT_FOUND_HEADERS = { "Cache-Control": "public, max-age=0, s-maxage=30" };

export async function loader({ params }: Route.LoaderArgs) {
  const pubkey = parsePubkey(params.author);
  if (pubkey === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  // One document, one URL: a hex key or an nprofile addresses the same author.
  if (params.author !== toNpub(pubkey)) {
    throw redirect(specPath({ pubkey, identifier: params.identifier }), 301);
  }

  const spec = await loadSpec(pubkey, params.identifier);
  if (spec === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  return spec;
}

/**
 * Read by the shared cache in front of the app, not by the browser: a reader
 * coming back to a page should see the revision that is live now, while a crawler
 * hitting a popular document should not cost a relay query.
 *
 * The headers a thrown response carries only reach this point through
 * `errorHeaders`, and only because this route owns its own error boundary.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
  return (
    errorHeaders ?? {
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
    }
  );
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found" }];
  return [
    { title: `${loaderData.title} | Open Specs` },
    { name: "description", content: loaderData.summary },
  ];
}

const STATUS_TONE: Record<string, string> = {
  draft: "text-signal-open",
  proposal: "text-signal-open",
  proposed: "text-signal-open",
  experimental: "text-signal-open",
  wip: "text-signal-open",
  accepted: "text-signal-settled",
  active: "text-signal-settled",
  final: "text-signal-settled",
  stable: "text-signal-settled",
  deprecated: "text-signal-closed",
  obsolete: "text-signal-closed",
  rejected: "text-signal-closed",
  retired: "text-signal-closed",
  withdrawn: "text-signal-closed",
};

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

const Masthead = ({ spec }: { spec: SpecPage }) => (
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

    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      {spec.status !== null && (
        <span className={STATUS_TONE[spec.status.toLowerCase()] ?? "text-muted"}>
          {spec.status}
        </span>
      )}
      {spec.kinds.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted">covers</span>
          {spec.kinds.map((kind) => (
            <span key={kind.raw}>
              {kind.raw}
              {kind.name !== null && <span className="text-muted"> {kind.name}</span>}
            </span>
          ))}
        </span>
      )}
      {spec.topics.map((topic) => (
        <span key={topic} className="text-muted">
          #{topic}
        </span>
      ))}
    </div>

    <div className="mt-8 inline-flex max-w-full items-start gap-4 rounded-sm border border-rule px-4 py-3.5">
      <KeyMark pubkey={spec.pubkey} />
      <dl className="min-w-0 space-y-1 font-mono text-xs">
        <Field label="signed by">{shorten(spec.npub, 10, 6)}</Field>
        <Field label="published">{asDate(spec.publishedAt)}</Field>
        {spec.revisedAt > spec.publishedAt && (
          <Field label="revised">{asDate(spec.revisedAt)}</Field>
        )}
        <Field label="event">{shorten(spec.eventId, 10, 4)}</Field>
      </dl>
    </div>
  </header>
);

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-dvh bg-paper text-ink">
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4">
        <Link to="/" className="font-mono text-xs uppercase tracking-[0.2em]">
          Open Specs
        </Link>
        <p className="hidden font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted sm:block">
          Signed and stored on Nostr
        </p>
      </div>
    </div>
    {children}
  </div>
);

export default function Spec({ loaderData }: Route.ComponentProps) {
  const spec = loaderData;

  return (
    <Shell>
      <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <Masthead spec={spec} />

        <div className="mt-14 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <Contents headings={spec.headings} />
          {spec.isEmpty ? (
            <p className="max-w-[40rem] font-serif text-lg text-muted">
              No text yet. Its author published this record without a body.
            </p>
          ) : (
            // Sanitized in the loader, by the same pipeline that produced the markup.
            <div
              className="doc max-w-[40rem]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server rendered Markdown
              dangerouslySetInnerHTML={{ __html: spec.html }}
            />
          )}
        </div>
      </article>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const missing = isRouteErrorResponse(error) && error.status === 404;

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-6 py-24">
        <p className="font-mono text-xs tracking-wide text-muted">
          {isRouteErrorResponse(error) ? error.status : "error"}
        </p>
        <h1 className="mt-4 font-mono text-3xl font-medium tracking-tight">
          {missing ? "No document at this address" : "The relays did not answer"}
        </h1>
        <p className="mt-4 max-w-xl font-serif text-lg leading-relaxed text-muted">
          {missing
            ? "Nothing signed under this key carries this identifier. It may have never been published, or it may live on a relay this server does not read."
            : "This page is built from relays, and they could not be reached. Reloading in a moment usually works."}
        </p>
        <Link
          to="/"
          className="mt-8 inline-block font-mono text-xs uppercase tracking-[0.16em] underline underline-offset-4"
        >
          Back to Open Specs
        </Link>
      </div>
    </Shell>
  );
}
