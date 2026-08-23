import { diffMarkdown, type MarkdownDiff } from "@openspecs/markdown";
import { createLoadCache } from "./cache.server";
import { mentionResolver } from "./mention";
import type { CachedSpec } from "./specs.server";

/**
 * Below this, the two documents share a name but not a text, and a diff page
 * would mark most of both. The reader is told so instead of shown noise. The
 * NIP forks in the wild sit near 0.9, an honest rewrite near 0.2.
 */
export const KINSHIP_FLOOR = 0.35;

/**
 * Keyed on the two revisions, so a diff is computed once per pair however many
 * readers open it, and a republished document makes a new key by itself.
 */
const diffs = createLoadCache<MarkdownDiff>({ max: 100, ttlMs: 60 * 60 * 1000 });

export const loadDiff = (base: CachedSpec, other: CachedSpec): Promise<MarkdownDiff> =>
  diffs.get(`${base.page.eventId}:${other.page.eventId}`, async () =>
    diffMarkdown(base.event.content, other.event.content, { mention: mentionResolver({}) }),
  );
