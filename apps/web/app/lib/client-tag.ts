const CLIENT_TAG_KEY = "openspecs:client-tag";

/** The one value that means yes. Anything else, absence included, means no. */
const ON = "on";

/**
 * Whether the events this browser signs say which app signed them.
 *
 * `["client", "openspecs"]` is a courtesy to the people who build clients and a
 * disclosure by whoever publishes: it stays on the relays for good, it says what
 * software a key runs, and it is one more thing that tells two keys apart or
 * groups them together. Nobody agreed to that by writing a comment, and it
 * cannot be taken back once a relay holds it.
 *
 * So it is off unless it is asked for, and asked for here rather than per event:
 * naming the app on one comment and not the next says more than doing either
 * consistently.
 */
const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

const listeners = new Set<() => void>();

let names = false;
let read = false;

export const subscribeClientTag = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

export const namesClient = (): boolean => {
  if (!read) {
    read = true;
    try {
      names = store()?.getItem(CLIENT_TAG_KEY) === ON;
    } catch {
      names = false;
    }
  }
  return names;
};

/** The server signs nothing, and its snapshot is the default the page hydrates to. */
export const serverNamesClient = (): boolean => false;

export const setNamesClient = (on: boolean): void => {
  names = on;
  read = true;
  try {
    if (on) store()?.setItem(CLIENT_TAG_KEY, ON);
    else store()?.removeItem(CLIENT_TAG_KEY);
  } catch {}
  notify();
};

/**
 * Applied where a draft is signed rather than where it is built: the builders in
 * `@openspecs/nostr` are shared with the importer, which rewrites this tag into
 * its own name and needs to keep finding it.
 */
export const withClientTag = (tags: string[][]): string[][] =>
  namesClient() ? tags : tags.filter((tag) => tag[0] !== "client");
