import { authorPath, parseCoordinate, specPath, toNpub } from "@openspecs/nostr";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { type MuteTarget, unblock, useBlocked } from "~/lib/blocked";
import { keyTextColor } from "~/lib/color";
import { authorName, shortNpub } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";

const HEADING = "font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const LINK = "min-w-0 truncate font-mono text-xs hover:underline";

const REMOVE =
  "shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-signal-closed";

const shorten = (id: string): string => `${id.slice(0, 10)}...${id.slice(-4)}`;

const Rows = ({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) => (
  <section className="space-y-4">
    <h2 className={HEADING}>
      {title}
      <span className="ml-3 normal-case tracking-normal">{count}</span>
    </h2>
    <ul className="divide-y divide-rule border-y border-rule">{children}</ul>
  </section>
);

const Row = ({ target, children }: { target: MuteTarget; children: React.ReactNode }) => (
  <li className="flex items-center justify-between gap-4 py-2">
    {children}
    <button type="button" onClick={() => unblock(target)} className={REMOVE}>
      Unblock
    </button>
  </li>
);

/**
 * Every row leads back to what it hides, except a comment's: the record holds
 * its id and not the document it hangs from, and a relay round trip to draw a
 * row whose only control is Unblock is not worth the row.
 */
export const BlockedList = () => {
  const blocked = useBlocked();
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  const pubkeys = useMemo(() => [...blocked.pubkeys], [blocked]);
  const documents = useMemo(
    () =>
      [...blocked.coordinates].flatMap((coordinate) => {
        const pointer = parseCoordinate(coordinate);
        return pointer === null ? [] : [{ coordinate, ...pointer }];
      }),
    [blocked],
  );
  const comments = useMemo(() => [...blocked.eventIds], [blocked]);

  useEffect(() => {
    if (pubkeys.length > 0) wantAuthors(pubkeys);
  }, [pubkeys]);

  const empty = pubkeys.length + documents.length + comments.length === 0;

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <p className={NOTE}>
          What you block is hidden from you on this site. Nobody is told, and nothing is hidden from
          anyone else.
        </p>
        <p className={NOTE}>Kept on this device.</p>
      </section>

      {empty && <p className={NOTE}>Nothing blocked.</p>}

      {pubkeys.length > 0 && (
        <Rows title="Accounts" count={pubkeys.length}>
          {pubkeys.map((pubkey) => {
            const npub = toNpub(pubkey);
            const author = authors[pubkey] ?? null;
            return (
              <Row key={pubkey} target={{ type: "p", value: pubkey }}>
                <Link
                  to={authorPath(pubkey)}
                  className="flex min-w-0 items-center gap-3"
                  title={`Everything signed by ${npub}`}
                >
                  <AuthorAvatar pubkey={pubkey} picture={author?.picture ?? null} size={24} />
                  <span
                    style={{ color: keyTextColor(pubkey) }}
                    className="min-w-0 truncate font-mono text-xs font-medium"
                  >
                    {authorName(author, npub)}
                  </span>
                </Link>
              </Row>
            );
          })}
        </Rows>
      )}

      {documents.length > 0 && (
        <section className="space-y-4">
          <Rows title="Documents" count={documents.length}>
            {documents.map((document) => (
              <Row key={document.coordinate} target={{ type: "a", value: document.coordinate }}>
                <Link to={specPath(document)} className={LINK}>
                  {document.identifier}
                  <span className="ml-3 text-muted">{shortNpub(toNpub(document.pubkey))}</span>
                </Link>
              </Row>
            ))}
          </Rows>
          <p className={NOTE}>
            A document in a mute list is this site's addition. Other clients keep the entry and
            ignore it.
          </p>
        </section>
      )}

      {comments.length > 0 && (
        <Rows title="Comments" count={comments.length}>
          {comments.map((id) => (
            <Row key={id} target={{ type: "e", value: id }}>
              <span className="min-w-0 truncate font-mono text-xs">{shorten(id)}</span>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
};
