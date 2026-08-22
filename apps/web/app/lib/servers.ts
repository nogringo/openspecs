export type Servers = Record<string, string[]>;

export const NO_SERVERS: Servers = {};

/** Long enough that a page of broken avatars asks once, short enough not to be felt. */
const BATCH_MS = 200;

let state = NO_SERVERS;
let asked = new Set<string>();
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

export const subscribeServers = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const serversState = (): Servers => state;

/** The server holding a picture is the browser's problem: the server rendered the address. */
export const serverServersState = (): Servers => NO_SERVERS;

const resolve = async (pubkeys: string[]): Promise<void> => {
  try {
    // nostr-tools comes with the recovery, not with the page: this is asked for
    // only once a picture has already failed, which is rare.
    const { fetchServerLists } = await import("@openspecs/nostr");
    const lists = await fetchServerLists(pubkeys);

    // Every key that was asked for is recorded, an empty answer included: a key
    // that named no servers still has to stop being asked, or the avatar that
    // could not be recovered asks again on every render.
    const next = { ...state };
    for (const pubkey of pubkeys) next[pubkey] = lists.get(pubkey) ?? [];

    state = next;
    for (const listener of listeners) listener();
  } catch {
    // The picture stays broken and its author keeps their mark, which is where
    // this started.
  }
};

/**
 * Where else an author's pictures might be. Asked for only when one of them has
 * failed to load, so an ordinary page never pays for this at all, and batched
 * because a listing whose avatars are all on one dead server fails all at once.
 */
export const wantServers = (pubkeys: string[]): void => {
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

export const clearServers = (): void => {
  state = NO_SERVERS;
  asked = new Set();
  pending = [];
  if (timer !== null) clearTimeout(timer);
  timer = null;
};
