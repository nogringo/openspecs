import type { Profile } from "@openspecs/nostr";

/** What a page shows of an author. `updatedAt` is what a drawn card is cached under. */
export type Author = Pick<
  Profile,
  "name" | "picture" | "nip05" | "about" | "lud16" | "lud06" | "updatedAt"
>;

export type Authors = Record<string, Author>;

/**
 * An author with nothing published about themselves is left out entirely: their
 * key already says everything the page knows about them, and a row with an empty
 * name would only be a hole where a name is elsewhere.
 *
 * A lightning address counts as something published, even alone: it is the one
 * field that decides whether a page can offer to pay them.
 */
export const toAuthor = (profile: Profile | null): Author | null =>
  profile === null ||
  (profile.name === "" &&
    profile.picture === null &&
    profile.nip05 === null &&
    profile.about === "" &&
    profile.lud16 === null &&
    profile.lud06 === null)
    ? null
    : {
        name: profile.name,
        picture: profile.picture,
        nip05: profile.nip05,
        about: profile.about,
        lud16: profile.lud16,
        lud06: profile.lud06,
        updatedAt: profile.updatedAt,
      };

/** Both ends kept: the first characters identify the key, the last ones confirm it. */
export const shortNpub = (npub: string): string => `${npub.slice(0, 12)}...${npub.slice(-6)}`;

/** A name is what a key says about itself, so the key is what stands in for it. */
export const authorName = (author: Author | null, npub: string): string =>
  author?.name || shortNpub(npub);

/**
 * What a page and a card say about an author before their documents are read.
 * Their own words come first: nothing this site derives beats a description
 * written by the person it describes.
 */
export const authorDescription = (author: Author | null, npub: string, count: number): string => {
  if (author?.about) return author.about;
  const name = authorName(author, npub);
  if (count === 0) return `${name} has signed no specification yet.`;
  const documents = count === 1 ? "specification" : "specifications";
  return `${count} ${documents} signed by ${name}, published as Nostr events and readable by anyone.`;
};
