import { SPEC_KIND, toCoordinate } from "@openspecs/nostr";
import { useMemo, useSyncExternalStore } from "react";

const BLOCKED_KEY = "openspecs:blocked";

export const BLOCKED_VERSION = 1;

export type MuteType = "p" | "e" | "a";

export type MuteTarget = { type: MuteType; value: string };

/** A change made on this device that no signed list carries yet. */
export type Owed = MuteTarget & { op: "add" | "remove" };

/** On disk. The three lists are what is hidden; `owed` is what the relays have not been told. */
type Stored = { v: 1; p: string[]; e: string[]; a: string[]; owed: Owed[] };

/** In memory, what every consumer reads. */
export type Blocked = {
  pubkeys: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
  coordinates: ReadonlySet<string>;
  owed: readonly Owed[];
  /** The connected key's signed list has been read this session, so the sets include it. */
  published: boolean;
};

const EMPTY: Stored = { v: 1, p: [], e: [], a: [], owed: [] };

export const NO_BLOCKS: Blocked = Object.freeze({
  pubkeys: new Set<string>(),
  eventIds: new Set<string>(),
  coordinates: new Set<string>(),
  owed: [],
  published: false,
});

const HEX_64 = /^[0-9a-f]{64}$/;
const COORDINATE = new RegExp(`^${SPEC_KIND}:[0-9a-f]{64}:.+$`);

const valid = (type: MuteType, value: unknown): value is string =>
  typeof value === "string" && (type === "a" ? COORDINATE : HEX_64).test(value);

const isType = (value: unknown): value is MuteType =>
  value === "p" || value === "e" || value === "a";

/**
 * Written by hand rather than with zod, the way `parseSeen` is, and the same
 * parser guards the write: a record nothing can read is nothing blocked.
 */
export const parseBlocked = (input: unknown): Stored | null => {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.v !== BLOCKED_VERSION) return null;

  const list = (type: MuteType): string[] => {
    const held = record[type];
    return Array.isArray(held) ? [...new Set(held.filter((value) => valid(type, value)))] : [];
  };

  const owed: Owed[] = [];
  if (Array.isArray(record.owed)) {
    for (const item of record.owed) {
      if (typeof item !== "object" || item === null) continue;
      const { op, type, value } = item as Record<string, unknown>;
      if ((op !== "add" && op !== "remove") || !isType(type) || !valid(type, value)) continue;
      owed.push({ op, type, value });
    }
  }

  return { v: BLOCKED_VERSION, p: list("p"), e: list("e"), a: list("a"), owed };
};

const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

let held: Stored | null = null;
let published = false;
let snapshot: Blocked = NO_BLOCKS;

const listeners = new Set<() => void>();

const load = (): Stored => {
  try {
    const raw = store()?.getItem(BLOCKED_KEY);
    return (raw === null || raw === undefined ? null : parseBlocked(JSON.parse(raw))) ?? EMPTY;
  } catch {
    return EMPTY;
  }
};

const read = (): Stored => {
  held ??= load();
  return held;
};

const asSnapshot = (stored: Stored): Blocked => ({
  pubkeys: new Set(stored.p),
  eventIds: new Set(stored.e),
  coordinates: new Set(stored.a),
  owed: stored.owed,
  published,
});

/** Kept in memory whether or not the disk took it: storage is an accelerator, never a dependency. */
const write = (next: Stored): void => {
  held = next;
  snapshot = asSnapshot(next);
  try {
    store()?.setItem(BLOCKED_KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener();
};

/** Another tab wrote the record. Both are the same reader, so this one reads it back. */
const onStorage = (event: StorageEvent): void => {
  if (event.key !== null && event.key !== BLOCKED_KEY) return;
  held = load();
  snapshot = asSnapshot(held);
  for (const listener of listeners) listener();
};

export const subscribeBlocked = (listener: () => void): (() => void) => {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
};

export const blockedState = (): Blocked => {
  if (held === null) snapshot = asSnapshot(read());
  return snapshot;
};

/** The server knows nobody's blocks: every row is served, the browser hides its own. */
export const serverBlockedState = (): Blocked => NO_BLOCKS;

const same = (a: MuteTarget, b: MuteTarget): boolean => a.type === b.type && a.value === b.value;

/**
 * The sets say what is hidden; `owed` says how that differs from the last list
 * the relays were given. A click that undoes an unsent one cancels the debt
 * rather than adding a second entry, so five changes of mind owe nothing.
 */
const change = (target: MuteTarget, op: "add" | "remove"): void => {
  if (!valid(target.type, target.value)) return;
  const current = read();
  const has = current[target.type].includes(target.value);
  if (op === "add" ? has : !has) return;

  const opposite = current.owed.find((entry) => entry.op !== op && same(entry, target));
  const owed = opposite
    ? current.owed.filter((entry) => entry !== opposite)
    : [...current.owed, { ...target, op }];

  write({
    ...current,
    [target.type]:
      op === "add"
        ? [...current[target.type], target.value]
        : current[target.type].filter((value) => value !== target.value),
    owed,
  });
};

/** The click. The screen moves now; whatever publishes the list is told through `owed`. */
export const block = (target: MuteTarget): void => change(target, "add");

export const unblock = (target: MuteTarget): void => change(target, "remove");

export const isBlocked = (blocked: Blocked, target: MuteTarget): boolean =>
  (target.type === "p"
    ? blocked.pubkeys
    : target.type === "e"
      ? blocked.eventIds
      : blocked.coordinates
  ).has(target.value);

export const hidesSpec = (
  blocked: Blocked,
  spec: { pubkey: string; identifier: string },
): boolean => blocked.pubkeys.has(spec.pubkey) || blocked.coordinates.has(toCoordinate(spec));

export const hidesComment = (blocked: Blocked, comment: { id: string; pubkey: string }): boolean =>
  blocked.pubkeys.has(comment.pubkey) || blocked.eventIds.has(comment.id);

/**
 * The reader's live list, merged in: a union with what is here, minus what is
 * owed as a removal, since a relay still serving the revision before that
 * removal must not put the item back. Nothing is taken out on the strength of
 * its absence from the live list: an unblock made elsewhere waits for one made
 * here.
 */
export const applyLive = (live: {
  pubkeys: string[];
  eventIds: string[];
  coordinates: string[];
}): void => {
  const current = read();
  const removing = (type: MuteType, value: string) =>
    current.owed.some((entry) => entry.op === "remove" && same(entry, { type, value }));
  const merge = (type: MuteType, mine: string[], theirs: string[]) => [
    ...new Set([
      ...mine,
      ...theirs.filter((value) => valid(type, value) && !removing(type, value)),
    ]),
  ];

  published = true;
  write({
    ...current,
    p: merge("p", current.p, live.pubkeys),
    e: merge("e", current.e, live.eventIds),
    a: merge("a", current.a, live.coordinates),
  });
};

/** These changes reached a signed event, so they are no longer owed. */
export const settleOwed = (done: readonly Owed[]): void => {
  const current = read();
  write({
    ...current,
    owed: current.owed.filter(
      (entry) => !done.some((settled) => settled.op === entry.op && same(settled, entry)),
    ),
  });
};

/** The signer refused. The blocks stay on this device; the debt is forgotten. */
export const dropOwed = (): void => write({ ...read(), owed: [] });

/** Everything here, owed again as additions. What "Publish now" does. */
export const requeueAll = (): void => {
  const current = read();
  const adds = (type: MuteType) =>
    current[type].map((value) => ({ op: "add" as const, type, value }));
  write({
    ...current,
    owed: [
      ...current.owed.filter((entry) => entry.op === "remove"),
      ...adds("p"),
      ...adds("e"),
      ...adds("a"),
    ],
  });
};

/** A different key connected, or none: whatever list was read belonged to the last one. */
export const markUnpublished = (): void => {
  published = false;
  write(read());
};

export const clearBlocked = (): void => {
  held = null;
  published = false;
  snapshot = NO_BLOCKS;
  try {
    store()?.removeItem(BLOCKED_KEY);
  } catch {}
};

export const useBlocked = (): Blocked =>
  useSyncExternalStore(subscribeBlocked, blockedState, serverBlockedState);

/** The rows a reader has not blocked. Stable while nothing changes, since `useLikes` keys an effect on it. */
export const useShown = <T extends { pubkey: string; identifier: string }>(rows: T[]): T[] => {
  const blocked = useBlocked();
  return useMemo(() => rows.filter((row) => !hidesSpec(blocked, row)), [rows, blocked]);
};
