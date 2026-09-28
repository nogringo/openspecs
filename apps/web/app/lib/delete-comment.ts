import { buildCommentDeletion, type NostrEvent } from "@openspecs/nostr";
import { addToDiscussion, setDeleting } from "./discussion";
import { enqueue } from "./outbox";
import { signDraft } from "./publish";
import { commentRebroadcastRelays, FALLBACK_RELAYS } from "./relays";

/**
 * The click. The comment leaves the screen now; the signer and the relays are
 * told after. The deletion goes everywhere a rebroadcast would, since a copy
 * sent on is a copy that has to be asked to forget.
 */
export const deleteComment = async (comment: NostrEvent): Promise<void> => {
  if (typeof window === "undefined") return;
  setDeleting(comment.id, true);

  let event: NostrEvent;
  try {
    event = await signDraft(buildCommentDeletion(comment.id));
  } catch {
    // The signer said no. That is the one thing the screen has to take back.
    setDeleting(comment.id, false);
    return;
  }

  addToDiscussion(event);
  const relays = await commentRebroadcastRelays(comment).catch(() => FALLBACK_RELAYS);
  enqueue(event, relays);
};
