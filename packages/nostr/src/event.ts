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

export const firstTag = (event: NostrEvent, name: string): string[] | undefined =>
  event.tags.find((tag) => tag[0] === name);

export const tagValue = (event: NostrEvent, name: string): string =>
  (firstTag(event, name)?.[1] ?? "").trim();

export const allTags = (event: NostrEvent, name: string): string[][] =>
  event.tags.filter((tag) => tag[0] === name);
