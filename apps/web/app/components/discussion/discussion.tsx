import { type CommentNode, SPEC_KIND, toNpub } from "@openspecs/nostr";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import {
  discussionState,
  NO_RESPONSE,
  serverDiscussionState,
  startDiscussion,
  stopDiscussion,
  subscribeDiscussionState,
} from "~/lib/discussion";
import { DISCUSSION_ID } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { CommentThread } from "./comment";
import { Composer } from "./composer";
import { Tally } from "./tally";

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

const Heading = () => (
  <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">Discussion</h2>
);

/**
 * The one line that says what this record holds. Written as a docket rather than
 * a count of replies: who wrote is as much of the shape of a review as how much.
 */
const Docket = ({
  count,
  correspondents,
  since,
}: {
  count: number;
  correspondents: number;
  since: number | null;
}) => (
  <p className="mt-3 font-mono text-xs text-muted">
    {plural(count, "comment")}
    {correspondents > 0 && ` · ${plural(correspondents, "correspondent")}`}
    {since !== null && ` · since ${asDate(since)}`}
  </p>
);

/**
 * Where the document stopped being the document these comments are about. An
 * addressable event is replaced by its own revisions, so everything above this
 * line was written about a text that no longer exists, and nothing else on the
 * page can say so: only this site has both the document's revision date and the
 * dates of what was said about it.
 */
const RevisionLine = ({ revisedAt }: { revisedAt: number }) => (
  <div className="flex items-center gap-3" aria-hidden="true">
    <span className="h-px flex-1 bg-rule" />
    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
      revised {asDate(revisedAt)}
    </span>
    <span className="h-px flex-1 bg-rule" />
  </div>
);

export type DiscussionProps = {
  coordinate: string;
  specEventId: string;
  /** The document's author, who is the root scope of every comment here. */
  pubkey: string;
  /** The document author's own relays, resolved by the loader. */
  relays: string[];
  /** When the document was last edited, or null if it never was. */
  revisedAt: number | null;
};

export const Discussion = ({
  coordinate,
  specEventId,
  pubkey,
  relays,
  revisedAt,
}: DiscussionProps) => {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const me = session.pubkey;
  const root = { coordinate, pubkey };

  // The loader hands over a fresh array on every revalidation, and an array is
  // never equal to the one before it, so what the effect watches is its content.
  const relayKey = relays.join(" ");
  useEffect(() => {
    startDiscussion({
      coordinate,
      specEventId,
      relays: relayKey === "" ? [] : relayKey.split(" "),
    });
    return stopDiscussion;
  }, [coordinate, specEventId, relayKey]);

  const discussion = useSyncExternalStore(
    subscribeDiscussionState,
    discussionState,
    serverDiscussionState,
  );
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  // Only the keys a reader ended up in front of, asked for in one batch.
  useEffect(() => {
    wantAuthors([pubkey, ...discussion.correspondents]);
  }, [pubkey, discussion.correspondents]);

  // The record of another document is not this one's, and the store holds one at
  // a time: until it has caught up, this page has nothing of its own to draw.
  const mine = discussion.coordinate === coordinate;
  /**
   * Drawn once the record stands, not as it arrives. A retraction can only be
   * asked for by the id of what it takes back, so it always lands one round trip
   * behind: showing the conversation before then means showing comments and
   * reactions that vanish a moment later.
   */
  const ready = mine && discussion.status === "ready";
  const roots = ready ? discussion.roots : [];
  /** Nothing has been asked of any relay yet: this is what the server renders. */
  const waiting = !mine || discussion.status === "idle";

  const { before, after } = useMemo(() => split(roots, revisedAt), [roots, revisedAt]);
  const since = roots[0]?.comment.createdAt ?? null;

  /**
   * A link from a notification names the comment it is about. The browser looks
   * for that anchor when the page loads and does not find it: the conversation
   * is fetched from the relays afterwards, and drawn later still. So the scroll
   * is done here, once the record stands, and once per hash, or a reader who has
   * scrolled away would be dragged back by the next event to arrive.
   */
  const { hash } = useLocation();
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const id = hash.slice(1);
    if (!ready || id === "" || id === DISCUSSION_ID || jumped.current === hash) return;
    jumped.current = hash;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [hash, ready]);

  return (
    <section id={DISCUSSION_ID} className="mt-16 border-t border-rule pt-8">
      <Heading />
      {ready && discussion.count > 0 && (
        <Docket
          count={discussion.count}
          correspondents={discussion.correspondents.length}
          since={since}
        />
      )}

      <div className="mt-5">
        <Tally
          response={ready ? discussion.document : NO_RESPONSE}
          me={me}
          // The coordinate is what a reaction on a document has to carry: it is
          // the half that survives its author editing the text.
          target={{ id: specEventId, pubkey, kind: SPEC_KIND, coordinate }}
          author={authors[pubkey] ?? null}
          name={authorName(authors[pubkey] ?? null, toNpub(pubkey))}
        />
      </div>

      <div className="mt-6">
        {me === null ? (
          <p className="font-serif text-[0.9375rem] leading-relaxed text-muted">
            Connect a key to comment.
          </p>
        ) : (
          <Composer me={me} root={root} authors={authors} />
        )}
      </div>

      {roots.length === 0 ? (
        <div className="mt-6 font-serif text-[0.9375rem] leading-relaxed text-muted">
          {/* The server renders this section before anything has been read, and
              renders it again for a reader who runs no scripts at all. Saying
              "reading the relays" to the second one would never come true. */}
          {waiting ? (
            <noscript>
              Comments are loaded by the browser, and yours is not running scripts. The document
              above needs none.
            </noscript>
          ) : (
            <p>{discussion.status === "loading" ? "Reading the relays." : "No comments yet."}</p>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {before.map((node) => (
            <CommentThread
              key={node.comment.id}
              node={node}
              authors={authors}
              responses={discussion.byComment}
              root={root}
              me={me}
            />
          ))}
          {before.length > 0 && after.length > 0 && revisedAt !== null && (
            <RevisionLine revisedAt={revisedAt} />
          )}
          {after.map((node) => (
            <CommentThread
              key={node.comment.id}
              node={node}
              authors={authors}
              responses={discussion.byComment}
              root={root}
              me={me}
            />
          ))}
        </div>
      )}
    </section>
  );
};

/**
 * The thread cut at the moment the document was last revised. A comment is
 * placed by when it was written, which is all the record can honestly say: a
 * comment carries no pointer at the revision its author was reading.
 */
const split = (
  roots: CommentNode[],
  revisedAt: number | null,
): { before: CommentNode[]; after: CommentNode[] } => {
  if (revisedAt === null) return { before: [], after: roots };
  return {
    before: roots.filter((node) => node.comment.createdAt < revisedAt),
    after: roots.filter((node) => node.comment.createdAt >= revisedAt),
  };
};
