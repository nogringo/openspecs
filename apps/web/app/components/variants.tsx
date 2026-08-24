import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import { diffPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import type { Standing } from "~/lib/spots";
import type { Variant } from "~/lib/variants";
import { AuthorAvatar } from "./author-avatar";

export const VARIANTS_ID = "under-this-name";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * What their copy is, against the one on this page, in the fewest words that
 * stay honest: how many passages it changes, that it reads the same, or that
 * it only shares the name.
 */
const said = (standing: Standing): string => {
  if (standing.kind === "same") return "reads the same";
  if (standing.kind === "independent") return "its own writing";
  return `changes ${standing.places} ${standing.places === 1 ? "passage" : "passages"}`;
};

/**
 * The other documents published under this page's identifier. Drawn dashed like
 * everything on this site that is available rather than settled: nobody vouches
 * for these, they exist, and existing is the whole point.
 */
export const Variants = ({
  variants,
  standings,
  from,
}: {
  variants: Variant[];
  standings: Record<string, Standing>;
  /** The document whose page this section sits on, and a comparison's base side. */
  from: { npub: string; identifier: string };
}) => {
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  useEffect(() => {
    if (variants.length > 0) wantAuthors(variants.map((variant) => variant.pubkey));
  }, [variants]);

  if (variants.length === 0) return null;

  return (
    <section id={VARIANTS_ID} className="mt-16 border-t border-rule pt-8">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
        Under this name
      </h2>
      <p className="mt-3 font-serif text-[0.9375rem] leading-relaxed text-muted">
        Anyone may publish a document under this name. These are the other keys that have.
      </p>
      <ul className="mt-5 space-y-3">
        {variants.map((variant) => {
          const author = authors[variant.pubkey] ?? null;
          const standing = standings[variant.pubkey];
          return (
            <li
              key={variant.pubkey}
              className="flex gap-4 rounded-sm border border-dashed border-rule p-4 hover:border-muted"
            >
              <span className="mt-0.5 shrink-0">
                <AuthorAvatar pubkey={variant.pubkey} picture={author?.picture ?? null} size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <span
                    className="truncate font-mono text-sm font-medium"
                    style={{ color: keyTextColor(variant.pubkey) }}
                  >
                    {authorName(author, variant.npub)}
                  </span>
                  <time
                    dateTime={new Date(variant.revisedAt * 1000).toISOString()}
                    className="shrink-0 font-mono text-xs text-muted"
                  >
                    {asDate(variant.revisedAt)}
                  </time>
                </div>
                <Link
                  to={variant.path}
                  className="mt-1.5 block font-mono text-base font-medium hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  {variant.title}
                </Link>
                {variant.summary !== "" && (
                  <p className="mt-1.5 line-clamp-2 max-w-[38rem] font-serif text-sm leading-snug text-muted">
                    {variant.summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    to={diffPath(from.npub, from.identifier, variant.npub)}
                    title="This document, marked with what their copy changes"
                    className="inline-block rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink"
                  >
                    Compare
                  </Link>
                  {standing !== undefined && (
                    <span className="font-mono text-xs text-muted">{said(standing)}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
