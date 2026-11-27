import type { SpecDraft, SpecKindEntry } from "@openspecs/nostr";

/**
 * Where a document waits while it is being written, so a closed tab is not a
 * lost afternoon. Three prefixes rather than one, or a document whose identifier
 * is literally `new` would share a slot with the one nobody has addressed yet,
 * and starting a fork would eat whichever of those two it landed on. A document
 * nobody has addressed yet gets an id of its own, or starting a second one would
 * eat the first.
 *
 * NIP-37 encrypted drafts replace this. Until then a draft never leaves the
 * browser it was typed in, which is worth saying on screen rather than hiding.
 */
const NEW_PREFIX = "openspecs:draft:new:";
const DOC_PREFIX = "openspecs:draft:doc:";
const FORK_PREFIX = "openspecs:draft:fork:";

export const DRAFT_VERSION = 1;

/**
 * Past this a draft is left unsaved rather than throwing a quota error on every
 * keystroke. A specification this long is one whose author has a copy elsewhere.
 */
export const MAX_DRAFT_BYTES = 256_000;

export type StoredDraft = {
  v: 1;
  draft: SpecDraft;
  /** Milliseconds, so the panel offering it can say how long ago. */
  savedAt: number;
  /**
   * The id of the revision this was started from, null for a document that did
   * not exist yet. A document is replaceable, so an id that no longer matches
   * means it changed somewhere else and restoring would write over that.
   */
  basedOn: string | null;
};

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

const asTopics = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((topic): topic is string => typeof topic === "string") : [];

const asKinds = (value: unknown): SpecKindEntry[] =>
  Array.isArray(value)
    ? value
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
        )
        .map((entry) => ({ raw: asText(entry.raw), name: asText(entry.name) }))
    : [];

/**
 * Written by hand rather than with zod, which is not a dependency of this app,
 * the way `parseStoredSession` is. The same parser guards the write, so a shape
 * that changes can never leave a record nothing is able to read.
 */
export const parseStoredDraft = (input: unknown): StoredDraft | null => {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.v !== DRAFT_VERSION) return null;

  const held = record.draft;
  if (typeof held !== "object" || held === null) return null;
  const draft = held as Record<string, unknown>;

  return {
    v: 1,
    draft: {
      identifier: asText(draft.identifier),
      title: asText(draft.title),
      summary: asText(draft.summary),
      content: asText(draft.content),
      status: asText(draft.status),
      topics: asTopics(draft.topics),
      kinds: asKinds(draft.kinds),
    },
    savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
    basedOn: typeof record.basedOn === "string" ? record.basedOn : null,
  };
};

/**
 * Which of a key's drafts is meant. A fork waiting to be published is keyed on
 * the document it came from, so forking the same origin twice picks the draft
 * back up and forking another one does not.
 */
export type DraftSlot =
  | { of: "new"; id: string }
  | { of: "doc"; identifier: string }
  | { of: "fork"; origin: string };

const slot = (pubkey: string, at: DraftSlot): string => {
  if (at.of === "new") return `${NEW_PREFIX}${pubkey}:${at.id}`;
  if (at.of === "doc") return `${DOC_PREFIX}${pubkey}:${at.identifier}`;
  return `${FORK_PREFIX}${pubkey}:${at.origin}`;
};

/** Short, since it sits in the address bar, and random, since two tabs pick one each. */
export const newDraftId = (): string => {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Storage is an accelerator, never a dependency: a private window whose
 * `setItem` throws means a draft that lives until the tab closes, not an editor
 * that refuses to open.
 */
const local = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export const readDraft = (pubkey: string, at: DraftSlot): StoredDraft | null => {
  try {
    const raw = local()?.getItem(slot(pubkey, at));
    return raw === null || raw === undefined ? null : parseStoredDraft(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const writeDraft = (pubkey: string, at: DraftSlot, stored: StoredDraft): void => {
  if (parseStoredDraft(stored) === null) return;
  try {
    const serialized = JSON.stringify(stored);
    if (serialized.length > MAX_DRAFT_BYTES) return;
    local()?.setItem(slot(pubkey, at), serialized);
  } catch {}
};

export const clearDraft = (pubkey: string, at: DraftSlot): void => {
  try {
    local()?.removeItem(slot(pubkey, at));
  } catch {}
};

export type DraftEntry = { slot: DraftSlot; stored: StoredDraft };

const slotOf = (pubkey: string, key: string): DraftSlot | null => {
  const rest = (prefix: string) =>
    key.startsWith(`${prefix}${pubkey}:`) ? key.slice(prefix.length + pubkey.length + 1) : null;
  const id = rest(NEW_PREFIX);
  if (id !== null) return { of: "new", id };
  const identifier = rest(DOC_PREFIX);
  if (identifier !== null) return { of: "doc", identifier };
  const origin = rest(FORK_PREFIX);
  return origin === null ? null : { of: "fork", origin };
};

/**
 * Before new documents had ids there was one slot per key, and the draft in it
 * is moved to an id of its own rather than left where nothing reads it.
 */
const adoptUnnamed = (storage: Storage, pubkey: string): void => {
  const raw = storage.getItem(`${NEW_PREFIX}${pubkey}`);
  if (raw === null) return;
  storage.setItem(slot(pubkey, { of: "new", id: newDraftId() }), raw);
  storage.removeItem(`${NEW_PREFIX}${pubkey}`);
};

/** Every draft this browser holds for a key, the most recently saved first. */
export const listDrafts = (pubkey: string): DraftEntry[] => {
  try {
    const storage = local();
    if (storage === undefined) return [];
    adoptUnnamed(storage, pubkey);

    const keys: string[] = [];
    for (let at = 0; at < storage.length; at++) {
      const key = storage.key(at);
      if (key !== null) keys.push(key);
    }

    const entries: DraftEntry[] = [];
    for (const key of keys) {
      const found = slotOf(pubkey, key);
      const stored = found === null ? null : readDraft(pubkey, found);
      if (found !== null && stored !== null) entries.push({ slot: found, stored });
    }
    return entries.sort((left, right) => right.stored.savedAt - left.stored.savedAt);
  } catch {
    return [];
  }
};
