const SEEN_KEY = "openspecs:seen";

export const SEEN_VERSION = 1;

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * A browser that has held eight keys has forgotten why it held the first, and
 * the mark of a key nobody signs in with any more is thirty bytes of nothing.
 * The oldest mark goes, which is the one whose key read its news longest ago.
 */
const MAX_KEYS = 8;

/** When each key was last shown its news, in unix seconds. */
type Seen = { v: 1; at: Record<string, number> };

const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

/**
 * Written by hand rather than with zod, the way `parseStoredSession` is, and the
 * same parser guards the write: a record nothing can read is a badge that counts
 * from the beginning of time.
 */
export const parseSeen = (input: unknown): Seen | null => {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.v !== SEEN_VERSION) return null;
  if (typeof record.at !== "object" || record.at === null) return null;

  const at: Record<string, number> = {};
  for (const [pubkey, value] of Object.entries(record.at as Record<string, unknown>)) {
    if (!HEX_64.test(pubkey)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    at[pubkey] = Math.floor(value);
  }
  return { v: SEEN_VERSION, at };
};

/**
 * Read through on every call rather than held in memory. Two tabs of this site
 * are two readers of the same mail, and the one that reads it should not have to
 * tell the other: the record on disk is what both of them ask.
 */
const read = (): Seen => {
  try {
    const raw = store()?.getItem(SEEN_KEY);
    return (
      (raw === null || raw === undefined ? null : parseSeen(JSON.parse(raw))) ?? {
        v: SEEN_VERSION,
        at: {},
      }
    );
  } catch {
    return { v: SEEN_VERSION, at: {} };
  }
};

const write = (seen: Seen): void => {
  const kept = Object.entries(seen.at)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYS);
  try {
    store()?.setItem(SEEN_KEY, JSON.stringify({ v: SEEN_VERSION, at: Object.fromEntries(kept) }));
  } catch {}
};

export const seenAt = (pubkey: string): number | null => read().at[pubkey] ?? null;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * The mark a key reads its news against, seeded on the first sight of that key.
 *
 * A badge claims that something happened while you were away. A key connecting
 * to this browser for the first time has never been here, so there was no while,
 * and there is nothing this browser can honestly say about the five hundred
 * things that happened before it met them. So the first sight of a key is the
 * moment it starts counting from, and the news before it is history.
 */
export const noteKey = (pubkey: string, now = nowSeconds()): number => {
  const seen = read();
  const held = seen.at[pubkey];
  if (held !== undefined) return held;

  seen.at[pubkey] = now;
  write(seen);
  return now;
};

/**
 * Only ever forward. What is read stays read, whatever order two tabs write in
 * and whatever a clock says after the machine has slept.
 */
export const markSeen = (pubkey: string, at: number): void => {
  if (!Number.isFinite(at)) return;
  const seen = read();
  const held = seen.at[pubkey] ?? 0;
  if (at <= held) return;

  seen.at[pubkey] = Math.floor(at);
  write(seen);
};

export const forgetSeen = (): void => {
  try {
    store()?.removeItem(SEEN_KEY);
  } catch {}
};

/** Strictly newer, so the event that set the mark is not counted again. */
export const unreadCount = (notices: { createdAt: number }[], at: number): number =>
  notices.filter((notice) => notice.createdAt > at).length;
