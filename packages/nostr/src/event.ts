import { z } from "zod";

export const SPEC_KIND = 30817;

const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));

export const nostrEventSchema = z.object({
  id: hex(64),
  pubkey: hex(64),
  created_at: z.number().int().nonnegative(),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: hex(128),
});

export type NostrEvent = z.infer<typeof nostrEventSchema>;

/**
 * An event before anyone signed it. `created_at` is left to whoever publishes
 * it, so the moment stamped on an event is the moment it was actually sent.
 */
export type EventDraft = { kind: number; content: string; tags: string[][] };

/**
 * The revision an author published last. Relays and indexers serve the stale
 * copies of a replaceable event next to the live one, and an author reading
 * their own back to edit it must start from the newest or publish an old one.
 */
export const newestEvent = (
  events: NostrEvent[],
  pubkey: string,
  kind: number,
): NostrEvent | null =>
  events.reduce<NostrEvent | null>(
    (newest, event) =>
      event.pubkey !== pubkey || event.kind !== kind
        ? newest
        : newest === null || event.created_at > newest.created_at
          ? event
          : newest,
    null,
  );

export const firstTag = (event: NostrEvent, name: string): string[] | undefined =>
  event.tags.find((tag) => tag[0] === name);

export const tagValue = (event: NostrEvent, name: string): string =>
  (firstTag(event, name)?.[1] ?? "").trim();

export const allTags = (event: NostrEvent, name: string): string[][] =>
  event.tags.filter((tag) => tag[0] === name);
