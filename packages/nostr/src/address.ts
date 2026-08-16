import { decode, naddrEncode, npubEncode } from "nostr-tools/nip19";
import { SPEC_KIND } from "./event";

export type SpecPointer = {
  pubkey: string;
  identifier: string;
  relays: string[];
};

const HEX_64 = /^[0-9a-f]{64}$/;

const normalize = (input: string): string => input.trim().replace(/^nostr:/i, "");

/** The `kind:pubkey:d` form used by `a` tags. */
export const toCoordinate = (pointer: Pick<SpecPointer, "pubkey" | "identifier">): string =>
  `${SPEC_KIND}:${pointer.pubkey}:${pointer.identifier}`;

/**
 * Returns null for a coordinate that does not address a specification, which is
 * also how junk in an `a` tag is filtered out.
 */
export const parseCoordinate = (input: string): SpecPointer | null => {
  const parts = normalize(input).split(":");
  const [kind, pubkey] = parts;
  // An identifier may itself contain colons, so only the first two fields are split off.
  const identifier = parts.slice(2).join(":");
  if (kind !== String(SPEC_KIND) || !pubkey || !HEX_64.test(pubkey) || identifier === "") {
    return null;
  }
  return { pubkey, identifier, relays: [] };
};

export const toNaddr = (
  pointer: Pick<SpecPointer, "pubkey" | "identifier"> & { relays?: string[] },
): string =>
  naddrEncode({
    kind: SPEC_KIND,
    pubkey: pointer.pubkey,
    identifier: pointer.identifier,
    relays: pointer.relays,
  });

export const toNpub = (pubkey: string): string => npubEncode(pubkey);

const tryDecode = (input: string) => {
  try {
    return decode(input.toLowerCase());
  } catch {
    return null;
  }
};

/** Accepts an npub, an nprofile or a bare hex key. */
export const parsePubkey = (input: string): string | null => {
  const value = normalize(input);
  if (HEX_64.test(value.toLowerCase())) return value.toLowerCase();
  const decoded = tryDecode(value);
  if (decoded?.type === "npub") return decoded.data;
  if (decoded?.type === "nprofile") return decoded.data.pubkey;
  return null;
};

/** Accepts an naddr or a `30817:pubkey:d` coordinate, with or without the `nostr:` prefix. */
export const parseSpecAddress = (input: string): SpecPointer | null => {
  const value = normalize(input);
  const decoded = tryDecode(value);
  if (decoded?.type === "naddr") {
    const { kind, pubkey, identifier, relays } = decoded.data;
    if (kind !== SPEC_KIND || !HEX_64.test(pubkey) || identifier === "") return null;
    return { pubkey, identifier, relays: relays ?? [] };
  }
  return parseCoordinate(value);
};

/**
 * The canonical URL of a document. npub rather than NIP-05, because an npub
 * cannot expire and cannot be reassigned by a domain owner.
 */
export const specPath = (pointer: Pick<SpecPointer, "pubkey" | "identifier">): string =>
  `/spec/${toNpub(pointer.pubkey)}/${encodeURIComponent(pointer.identifier)}`;
