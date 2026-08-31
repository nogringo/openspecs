import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import type { Fork } from "~/lib/forks";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { AuthorAvatar } from "./author-avatar";
import { VARIANTS_ID } from "./variants";

export const FORKS_ID = "written-from-this";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The documents whose authors said they started from this one.
 *
 * Not the same list as the one under this name, and not a subset of it either.
 * That one is every key publishing at this address, a relation nobody declared
 * and which a shared name is the whole of; this one is a claim its author wrote
 * into their event, and it holds however they renamed what they wrote. A fork
 * that kept the name appears in both, and says so, because it is both things.
 *
 * Dashed like everything on this site that is available rather than settled:
 * this is what other keys say about where their writing came from, and nobody
 * here vouches for it.
 */
export const Forks = ({ forks }: { forks: Fork[] }) => {
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  useEffect(() => {
    if (forks.length > 0) wantAuthors(forks.map((fork) => fork.pubkey));
  }, [forks]);

  if (forks.length === 0) return null;

  return (
    <section id={FORKS_ID} className="mt-16 border-t border-rule pt-8">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
        Written from this one
      </h2>
      <p className="mt-3 font-serif text-[0.9375rem] leading-relaxed text-muted">
        These documents carry a tag saying they started here. Their authors put it there.
      </p>
      <ul className="mt-5 space-y-3">
        {forks.map((fork) => {
          const author = authors[fork.pubkey] ?? null;
          return (
            <li
              key={`${fork.pubkey}:${fork.identifier}`}
              className="flex gap-4 rounded-sm border border-dashed border-rule p-4 hover:border-muted"
            >
              <span className="mt-0.5 shrink-0">
                <AuthorAvatar pubkey={fork.pubkey} picture={author?.picture ?? null} size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <span
                    className="truncate font-mono text-sm font-medium"
                    style={{ color: keyTextColor(fork.pubkey) }}
                  >
                    {authorName(author, fork.npub)}
                  </span>
                  <time
                    dateTime={new Date(fork.revisedAt * 1000).toISOString()}
                    className="shrink-0 font-mono text-xs text-muted"
                  >
                    {asDate(fork.revisedAt)}
                  </time>
                </div>
                <Link
                  to={fork.path}
                  className="mt-1.5 block font-mono text-base font-medium hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  {fork.title}
                </Link>
                {fork.summary !== "" && (
                  <p className="mt-1.5 line-clamp-2 max-w-[38rem] font-serif text-sm leading-snug text-muted">
                    {fork.summary}
                  </p>
                )}
                <p className="mt-3 font-mono text-xs text-muted">
                  {fork.sameName ? (
                    <>
                      kept this name, so it is also{" "}
                      <a
                        href={`#${VARIANTS_ID}`}
                        className="underline decoration-rule underline-offset-2 hover:decoration-current"
                      >
                        under this name
                      </a>
                    </>
                  ) : (
                    fork.identifier
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
