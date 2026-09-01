import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import type { Copy } from "~/lib/copies";
import { diffPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { type Standing, standingKey } from "~/lib/spots";
import { AuthorAvatar } from "./author-avatar";

export const COPIES_ID = "other-copies";

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
 * The other documents that are copies of this one.
 *
 * One list, not two. Some of these were found publishing at this address and
 * some by the tag their author wrote saying they started here, and that
 * difference is how they were found rather than anything about them. What
 * separates a copy worth reading from a document that only shares a name is the
 * standing on its row, which is measured against the text.
 *
 * No sentence under the heading. The heading names the list, each row carries
 * its author, its standing and its address, and a paragraph saying this site
 * vouches for none of them would answer a suspicion nobody arrived with.
 *
 * Drawn dashed like everything on this site that is available rather than
 * settled: these exist, and existing is the whole point.
 */
export const Copies = ({
  copies,
  standings,
  from,
}: {
  copies: Copy[];
  standings: Record<string, Standing>;
  /** The document whose page this section sits on, and a comparison's base side. */
  from: { npub: string; identifier: string };
}) => {
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  useEffect(() => {
    if (copies.length > 0) wantAuthors(copies.map((copy) => copy.pubkey));
  }, [copies]);

  if (copies.length === 0) return null;

  return (
    <section id={COPIES_ID} className="mt-16 border-t border-rule pt-8">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
        Other copies
      </h2>
      <ul className="mt-5 space-y-3">
        {copies.map((copy) => {
          const author = authors[copy.pubkey] ?? null;
          const standing = standings[standingKey(copy)];
          return (
            <li
              key={standingKey(copy)}
              className="flex gap-4 rounded-sm border border-dashed border-rule p-4 hover:border-muted"
            >
              <span className="mt-0.5 shrink-0">
                <AuthorAvatar pubkey={copy.pubkey} picture={author?.picture ?? null} size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <span
                    className="truncate font-mono text-sm font-medium"
                    style={{ color: keyTextColor(copy.pubkey) }}
                  >
                    {authorName(author, copy.npub)}
                  </span>
                  <time
                    dateTime={new Date(copy.revisedAt * 1000).toISOString()}
                    className="shrink-0 font-mono text-xs text-muted"
                  >
                    {asDate(copy.revisedAt)}
                  </time>
                </div>
                <Link
                  to={copy.path}
                  className="mt-1.5 block font-mono text-base font-medium hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  {copy.title}
                </Link>
                {copy.summary !== "" && (
                  <p className="mt-1.5 line-clamp-2 max-w-[38rem] font-serif text-sm leading-snug text-muted">
                    {copy.summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    to={diffPath(from.npub, from.identifier, copy.npub, copy.identifier)}
                    title="This document, marked with what their copy changes"
                    className="inline-block rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink"
                  >
                    Compare
                  </Link>
                  {standing !== undefined && (
                    <span className="font-mono text-xs text-muted">{said(standing)}</span>
                  )}
                  {/* Only where it differs. A copy at this document's own address
                      would be repeating the line at the top of the page. */}
                  {!copy.sameName && (
                    <span className="font-mono text-xs text-muted">{copy.identifier}</span>
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
