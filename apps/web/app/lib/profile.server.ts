import { fetchProfiles } from "@openspecs/nostr";
import { withDeadline } from "./cache.server";
import { type Author, type Authors, toAuthor } from "./profile";

const DEADLINE_MS = 1000;

/**
 * A profile is the one thing on the page the document does not carry, so it is
 * also the one thing a reader can be served without. `fetchProfiles` holds its
 * own cache, and the request that outran this deadline still fills it.
 *
 * A listing asks for every author at once: one filter, one round trip, however
 * many rows are on the page.
 */
export const loadAuthors = (pubkeys: string[]): Promise<Authors> =>
  withDeadline(
    fetchProfiles(pubkeys)
      .then((profiles) => {
        const authors: Authors = {};
        for (const [pubkey, profile] of profiles) {
          const author = toAuthor(profile);
          if (author !== null) authors[pubkey] = author;
        }
        return authors;
      })
      .catch(() => ({})),
    {},
    DEADLINE_MS,
  );

export const loadAuthor = async (pubkey: string): Promise<Author | null> =>
  (await loadAuthors([pubkey]))[pubkey] ?? null;
