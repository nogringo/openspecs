import { parsePubkey, resolveNip05, specPath, toNpub } from "@openspecs/nostr";
import { data, Link, redirect } from "react-router";
import { ErrorPage } from "~/components/error-page";
import { Shell } from "~/components/shell";
import { keyTextColor } from "~/lib/color";
import { KINSHIP_FLOOR, loadDiff } from "~/lib/diff.server";
import { NOT_FOUND_HEADERS, PAGE_HEADERS } from "~/lib/http";
import { diffPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { loadAuthor } from "~/lib/profile.server";
import { loadSpec } from "~/lib/specs.server";
import type { Route } from "./+types/spec-diff";

const resolve = async (author: string): Promise<string | null> =>
  parsePubkey(author) ?? (await resolveNip05(author))?.pubkey ?? null;

export async function loader({ params }: Route.LoaderArgs) {
  const [pubkey, otherPubkey] = await Promise.all([resolve(params.author), resolve(params.other)]);
  if (pubkey === null || otherPubkey === null) {
    throw data({ missing: "address" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  // Left off where the other side kept this document's name, which is the common
  // case and what every link built before renaming was possible still says.
  const otherIdentifier = params.otherIdentifier ?? params.identifier;

  // A document diffed against itself is the document, which has its own page.
  if (pubkey === otherPubkey && otherIdentifier === params.identifier) {
    throw redirect(specPath({ pubkey, identifier: params.identifier }));
  }

  const path = diffPath(toNpub(pubkey), params.identifier, toNpub(otherPubkey), otherIdentifier);
  if (params.author !== toNpub(pubkey) || params.other !== toNpub(otherPubkey)) {
    throw redirect(path, 301);
  }

  const [base, other] = await Promise.all([
    loadSpec(pubkey, params.identifier),
    loadSpec(otherPubkey, otherIdentifier),
  ]);
  if (base === null || other === null) {
    throw data({ missing: "document" }, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const [diff, baseAuthor, otherAuthor] = await Promise.all([
    loadDiff(base, other),
    loadAuthor(pubkey),
    loadAuthor(otherPubkey),
  ]);

  return {
    base: base.page,
    other: other.page,
    diff,
    // Decided here rather than shipped as a threshold: the browser never
    // imports the server module this constant lives in.
    kin: diff.similarity >= KINSHIP_FLOOR,
    baseName: authorName(baseAuthor, base.page.npub),
    otherName: authorName(otherAuthor, other.page.npub),
  };
}

export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? PAGE_HEADERS;
}

/**
 * Never indexed: the two documents are the record, and this page is a reading
 * of them that exists for whoever asked for it.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData)
    return [{ title: "Not found | Open Specs" }, { name: "robots", content: "noindex" }];
  const { base, otherName } = loaderData;
  return [
    { title: `${base.identifier}: what ${otherName}'s copy changes | Open Specs` },
    { name: "robots", content: "noindex" },
  ];
}

const KeyName = ({
  pubkey,
  npub,
  identifier,
  name,
}: {
  pubkey: string;
  npub: string;
  identifier: string;
  name: string;
}) => (
  <Link
    to={specPath({ pubkey, identifier })}
    style={{ color: keyTextColor(pubkey) }}
    className="underline decoration-rule underline-offset-2 hover:decoration-current"
    title={`Read the copy signed by ${npub}`}
  >
    {name}
  </Link>
);

export default function SpecDiff({ loaderData }: Route.ComponentProps) {
  const { base, other, diff, kin, baseName, otherName } = loaderData;
  const shared = Math.round(diff.similarity * 100);

  const baseLink = (
    <KeyName pubkey={base.pubkey} npub={base.npub} identifier={base.identifier} name={baseName} />
  );
  const otherLink = (
    <KeyName
      pubkey={other.pubkey}
      npub={other.npub}
      identifier={other.identifier}
      name={otherName}
    />
  );

  return (
    <Shell>
      <article className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <header>
          <p className="font-mono text-xs tracking-wide text-muted">
            {base.kind}:{base.identifier}
          </p>
          <h1 className="mt-4 font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            What {otherName}'s copy changes
          </h1>
          <p className="mt-4 max-w-2xl font-serif text-lg leading-relaxed text-muted">
            The document signed by {baseLink}, read whole, with what the copy signed by {otherLink}{" "}
            changes marked in place.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs">
            {diff.changed && kin && (
              <>
                <span className="diff-key-ins rounded-sm px-2 py-1">only in {otherName}'s</span>
                <span className="diff-key-del rounded-sm px-2 py-1">only in {baseName}'s</span>
              </>
            )}
            <span className="text-muted">sharing {shared}% of their words</span>
            <Link
              to={diffPath(other.npub, other.identifier, base.npub, base.identifier)}
              className="text-muted underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-current"
            >
              Swap sides
            </Link>
          </div>
        </header>

        <div className="mx-auto mt-14 max-w-[40rem]">
          {!diff.changed ? (
            <p className="font-serif text-lg leading-relaxed text-muted">
              The two documents read the same. The signatures and the dates differ, and nothing in
              the text does.
            </p>
          ) : kin ? (
            // Sanitized by the same pipeline as every document page, block by block.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered Markdown
            <div className="doc" dangerouslySetInnerHTML={{ __html: diff.html }} />
          ) : (
            <p className="font-serif text-lg leading-relaxed text-muted">
              These two share a name, not a text: they hold {shared}% of their words in common, and
              marking the differences would mark nearly everything. Read them side by side instead:
              the copy signed by {baseLink}, and the one signed by {otherLink}.
            </p>
          )}
        </div>
      </article>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
