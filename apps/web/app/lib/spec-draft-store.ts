import type { SpecDraft, SpecKindEntry } from "@openspecs/nostr";

/**
 * Where a document waits while it is being written, so a closed tab is not a
 * lost afternoon. Three prefixes rather than one, or a document whose identifier
 * is literally `new` would share a slot with the one nobody has addressed yet,
 * and starting a fork would eat whichever of those two it landed on.
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
  | { of: "new" }
  | { of: "doc"; identifier: string }
  | { of: "fork"; origin: string };

const slot = (pubkey: string, at: DraftSlot): string => {
  if (at.of === "new") return `${NEW_PREFIX}${pubkey}`;
  if (at.of === "doc") return `${DOC_PREFIX}${pubkey}:${at.identifier}`;
  return `${FORK_PREFIX}${pubkey}:${at.origin}`;
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
