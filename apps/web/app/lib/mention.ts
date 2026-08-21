import type { Mention, MentionResolver } from "@openspecs/markdown";
import { authorPath, parsePubkey, parseSpecAddress, specPath, toNpub } from "@openspecs/nostr";
import { type Authors, shortNpub } from "./profile";

/**
 * Every key a piece of text points at, so a page can ask for those profiles in
 * the same batch as the ones it already wanted.
 */
export const mentionedKeys = (content: string): string[] => {
  const keys = new Set<string>();
  for (const match of content.matchAll(
    /nostr:((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi,
  )) {
    const pubkey = match[1] === undefined ? null : parsePubkey(match[1]);
    if (pubkey !== null) keys.add(pubkey);
  }
  return [...keys];
};

/**
 * A key becomes the name its owner published, or the short form of the key
 * itself, and links to their page. A document becomes its own address.
 *
 * Anything else, a note or an event this site has no page for, is left as the
 * text it was: a link that goes nowhere is worse than an identifier that at
 * least says what it is.
 */
export const mentionResolver =
  (authors: Authors): MentionResolver =>
  (uri: string): Mention | null => {
    const pubkey = parsePubkey(uri);
    if (pubkey !== null) {
      const npub = toNpub(pubkey);
      const name = authors[pubkey]?.name;
      return { label: `@${name || shortNpub(npub)}`, href: authorPath(pubkey) };
    }

    const spec = parseSpecAddress(uri);
    if (spec !== null) return { label: spec.identifier, href: specPath(spec) };

    return null;
  };
