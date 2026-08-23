import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import type { Variant } from "~/lib/variants";
import { AuthorAvatar } from "./author-avatar";

export const VARIANTS_ID = "under-this-name";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The other documents published under this page's identifier. Drawn dashed like
 * everything on this site that is available rather than settled: nobody vouches
 * for these, they exist, and existing is the whole point.
 */
export const Variants = ({ variants }: { variants: Variant[] }) => {
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
          return (
            <li key={variant.pubkey}>
              <Link
                to={variant.path}
                className="group flex gap-4 rounded-sm border border-dashed border-rule p-4 hover:border-muted"
              >
                <span className="mt-0.5 shrink-0">
                  <AuthorAvatar
                    pubkey={variant.pubkey}
                    picture={author?.picture ?? null}
                    size={28}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-4">
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
                  </span>
                  <span className="mt-1.5 block font-mono text-base font-medium group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                    {variant.title}
                  </span>
                  {variant.summary !== "" && (
                    <span className="mt-1.5 line-clamp-2 block max-w-[38rem] font-serif text-sm leading-snug text-muted">
                      {variant.summary}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
