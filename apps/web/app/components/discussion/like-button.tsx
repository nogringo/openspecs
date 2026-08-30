import { LIKE, likeCount, myLike, SPEC_KIND } from "@openspecs/nostr";
import { useEffect, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { discussionState, serverDiscussionState, subscribeDiscussionState } from "~/lib/discussion";
import { connectPath } from "~/lib/paths";
import {
  intentsState,
  serverIntentsState,
  setReaction,
  subscribeIntents,
  withIntent,
} from "~/lib/reactions";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { ThumbMark } from "../thumb-mark";

const CHROME =
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em]";

export type LikeButtonProps = {
  coordinate: string;
  specEventId: string;
  pubkey: string;
};

/**
 * The document's like, up in the masthead where a reader decides what they think
 * of it, drawn from the same record as the `+` chip under the discussion so the
 * two never disagree. `Discussion` opens that record; this only reads it.
 *
 * A click moves the button at once. The signer and the relays are told after,
 * and only a refused signature ever moves it back.
 */
export const LikeButton = ({ coordinate, specEventId, pubkey }: LikeButtonProps) => {
  useEffect(restoreSession, []);
  const location = useLocation();
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const me = session.pubkey;
  const discussion = useSyncExternalStore(
    subscribeDiscussionState,
    discussionState,
    serverDiscussionState,
  );
  const intents = useSyncExternalStore(subscribeIntents, intentsState, serverIntentsState);

  const target = { id: specEventId, pubkey, kind: SPEC_KIND, coordinate };
  // Gated the way the tally is: a like still to be matched against its retraction
  // would show a number here that goes back down a moment later.
  const ready = discussion.coordinate === coordinate && discussion.status === "ready";
  const held = ready ? discussion.document.reactions : [];
  const tallies = me === null ? held : withIntent(held, me, target, intents);
  const count = likeCount(tallies);
  const mine = me !== null && myLike(tallies, me) !== undefined;

  const body = (
    <>
      <ThumbMark />
      <span>{mine ? "Liked" : "Like"}</span>
      {/* Reserved whether or not the number is known: the row must not reflow when it lands. */}
      <span className="min-w-[2ch] text-right tabular-nums tracking-normal text-muted">
        {count > 0 ? count : ""}
      </span>
    </>
  );

  if (me === null) {
    return (
      <Link
        to={connectPath(`${location.pathname}${location.search}`)}
        title="Connect a key to like this"
        className={`${CHROME} border-rule text-muted hover:border-muted hover:text-ink`}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setReaction(me, target, LIKE, !mine)}
      title={mine ? "Take yours back" : count > 0 ? `${count} liked this` : "Like this"}
      className={`${CHROME} ${mine ? "border-ink text-ink" : "border-rule text-muted"} hover:border-muted hover:text-ink`}
    >
      {body}
    </button>
  );
};
