import { diffMarkdown, KINSHIP_FLOOR, type MarkdownDiff } from "@openspecs/markdown";
import { createLoadCache } from "./cache.server";
import { mentionResolver } from "./mention";
import type { CachedSpec } from "./specs.server";

export { KINSHIP_FLOOR };

/**
 * Keyed on the two revisions, so a diff is computed once per pair however many
 * readers open it, and a republished document makes a new key by itself.
 */
const diffs = createLoadCache<MarkdownDiff>({ max: 100, ttlMs: 60 * 60 * 1000 });

export const loadDiff = (base: CachedSpec, other: CachedSpec): Promise<MarkdownDiff> =>
  diffs.get(`${base.page.eventId}:${other.page.eventId}`, async () =>
    diffMarkdown(base.event.content, other.event.content, { mention: mentionResolver({}) }),
  );
