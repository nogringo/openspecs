import { type Authors, toAuthor } from "./profile";

export const NO_AUTHORS: Authors = {};

/** Long enough that a query being typed asks once, short enough not to be felt. */
const BATCH_MS = 200;

let state = NO_AUTHORS;
let asked = new Set<string>();
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

export const subscribeAuthors = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const authorsState = (): Authors => state;

/** The server hands its own authors to the page it renders; this store is the browser's. */
export const serverAuthorsState = (): Authors => NO_AUTHORS;

const resolve = async (pubkeys: string[]): Promise<void> => {
  try {
    // nostr-tools comes with the search, not with the page, so it is asked for
    // here rather than imported: the same rule the corpus follows.
    const { fetchProfiles } = await import("@openspecs/nostr");
    const profiles = await fetchProfiles(pubkeys);

    const next = { ...state };
    let found = false;
    for (const [pubkey, profile] of profiles) {
      const author = toAuthor(profile);
      if (author === null) continue;
      next[pubkey] = author;
      found = true;
    }
    if (!found) return;

    state = next;
    for (const listener of listeners) listener();
  } catch {
    // A profile that did not come back leaves the author their mark, which is
    // what every row was drawn with before any of this was asked for.
  }
};

/**
 * Results are re-ranked on every keystroke, and most of the authors under them
 * were already there a keystroke ago. Each key is asked for once per session,
 * and the keys that appear together are asked for together.
 */
export const wantAuthors = (pubkeys: string[]): void => {
  if (typeof window === "undefined") return;

  const fresh = pubkeys.filter((pubkey) => !asked.has(pubkey));
  if (fresh.length === 0) return;
  for (const pubkey of fresh) asked.add(pubkey);
  pending.push(...fresh);

  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void resolve(pending.splice(0));
  }, BATCH_MS);
};

export const clearAuthors = (): void => {
  state = NO_AUTHORS;
  asked = new Set();
  pending = [];
  if (timer !== null) clearTimeout(timer);
  timer = null;
};
