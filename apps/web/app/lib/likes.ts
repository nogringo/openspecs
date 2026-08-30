import { type Reaction, toCoordinate } from "@openspecs/nostr";
import { useEffect, useSyncExternalStore } from "react";

/** How many liked each document, by coordinate. Only what has been asked for is here. */
export type Likes = Record<string, number>;

export const NO_LIKES: Likes = Object.freeze({});

/** Long enough that a page of rows asks once, short enough not to be felt. */
const BATCH_MS = 200;

let state: Likes = NO_LIKES;
let asked = new Set<string>();
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

export const subscribeLikes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const likesState = (): Likes => state;

/** The server renders a row with the slot empty; the browser fills it. */
export const serverLikesState = (): Likes => NO_LIKES;

const notify = (): void => {
  for (const listener of listeners) listener();
};

export const likeKey = (spec: { pubkey: string; identifier: string }): string => toCoordinate(spec);

/**
 * Two passes, the way the discussion reads them: the likes by the documents'
 * coordinates, then the retractions by the likes' ids, since nothing indexes a
 * deletion by the document it eventually concerns. Relays index tags without
 * checking them, so every like is checked against the coordinates asked for.
 *
 * The relay client is asked for here rather than imported, the same rule the
 * profiles follow: a listing is read by people who never sign anything.
 */
const resolve = async (coordinates: string[]): Promise<void> => {
  try {
    const {
      CONVERSATION_RELAYS,
      DELETION_KIND,
      inChunks,
      LIKE,
      likeCount,
      parseDeletion,
      parseReaction,
      queryRelays,
      REACTION_KIND,
      tallyReactions,
    } = await import("@openspecs/nostr");

    const wanted = new Set(coordinates);
    const found = await Promise.all(
      inChunks(coordinates).map((chunk) =>
        queryRelays(CONVERSATION_RELAYS, { kinds: [REACTION_KIND], "#a": chunk }),
      ),
    );

    const seen = new Set<string>();
    const likes: Reaction[] = [];
    for (const event of found.flat()) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const reaction = parseReaction(event);
      if (reaction === null || reaction.symbol !== LIKE) continue;
      if (reaction.targetCoordinate === null || !wanted.has(reaction.targetCoordinate)) continue;
      likes.push(reaction);
    }

    const retracted =
      likes.length === 0
        ? []
        : await Promise.all(
            inChunks(likes.map((like) => like.id)).map((chunk) =>
              queryRelays(CONVERSATION_RELAYS, { kinds: [DELETION_KIND], "#e": chunk }),
            ),
          );
    const deletions = retracted
      .flat()
      .map(parseDeletion)
      .filter((deletion) => deletion !== null);

    const next = { ...state };
    for (const coordinate of coordinates) {
      const own = likes.filter((like) => like.targetCoordinate === coordinate);
      next[coordinate] = likeCount(tallyReactions(own, deletions));
    }
    state = next;
    notify();
  } catch {
    // Rows keep their empty slot, which is what they were drawn with.
  }
};

/** Each coordinate is asked for once per session, and the ones that appear together, together. */
export const wantLikes = (coordinates: string[]): void => {
  if (typeof window === "undefined") return;

  const fresh = coordinates.filter((coordinate) => !asked.has(coordinate));
  if (fresh.length === 0) return;
  for (const coordinate of fresh) asked.add(coordinate);
  pending.push(...fresh);

  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void resolve(pending.splice(0));
  }, BATCH_MS);
};

/**
 * A like this browser just signed, or took back. Moved by one rather than asked
 * for again: a relay asked a second after the click can still answer without
 * it, and a count that goes up and then back down is worse than one that waits.
 * A coordinate never asked for is left alone, since asking will find the like.
 */
export const rememberLike = (coordinate: string, delta: 1 | -1): void => {
  if (!asked.has(coordinate)) return;
  state = { ...state, [coordinate]: Math.max(0, (state[coordinate] ?? 0) + delta) };
  notify();
};

/** The counts for a page of rows, asked for together and filled in as they arrive. */
export const useLikes = (specs: { pubkey: string; identifier: string }[]): Likes => {
  const likes = useSyncExternalStore(subscribeLikes, likesState, serverLikesState);
  useEffect(() => {
    wantLikes(specs.map(likeKey));
  }, [specs]);
  return likes;
};

export const clearLikes = (): void => {
  state = NO_LIKES;
  asked = new Set();
  pending = [];
  if (timer !== null) clearTimeout(timer);
  timer = null;
};
