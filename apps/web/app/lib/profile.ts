import type { Profile } from "@openspecs/nostr";

/** What a page shows of an author. `updatedAt` is what a drawn card is cached under. */
export type Author = Pick<Profile, "name" | "picture" | "updatedAt">;

export type Authors = Record<string, Author>;

/**
 * An author with neither a name nor a picture is left out entirely: their key
 * already says everything the page knows about them, and a row with an empty
 * name would only be a hole where a name is elsewhere.
 */
export const toAuthor = (profile: Profile | null): Author | null =>
  profile === null || (profile.name === "" && profile.picture === null)
    ? null
    : { name: profile.name, picture: profile.picture, updatedAt: profile.updatedAt };
