import { z } from "zod";
import { nostrEventSchema } from "./event";
import { INDEXER_RELAYS } from "./nip65";
import { queryRelays, type RelayOptions, relaySet } from "./pool";

export const PROFILE_KIND = 0;

const PROFILE_TIMEOUT_MS = 2000;
const PROFILE_TTL_MS = 30 * 60 * 1000;

const MAX_NAME = 64;
const MAX_NIP05 = 128;
const MAX_ABOUT = 320;
const MAX_URL = 2048;

export type Profile = {
  pubkey: string;
  /** `display_name`, then `name`. Empty when the author published neither. */
  name: string;
  picture: string | null;
  /** A claim the author makes about themselves, which nothing here resolves. */
  nip05: string | null;
  /** The author's own description of themselves, shown on their page. */
  about: string;
  /** A lightning address, which is where a zap is paid. */
  lud16: string | null;
  /** The older bech32 `lnurl` form of the same thing. */
  lud06: string | null;
  updatedAt: number;
};

const text = z.string().optional().catch(undefined);

/**
 * A dozen clients write this object and none of them agree on what belongs in
 * it, so a field of the wrong type is dropped rather than taking the profile
 * with it. Unknown keys fall away on their own: only what is drawn is read.
 */
const metadataSchema = z.object({
  name: text,
  display_name: text,
  displayName: text,
  picture: text,
  nip05: text,
  about: text,
  lud16: text,
  lud06: text,
});

/**
 * A name is author-supplied text landing next to the key that signed the
 * document, and a right-to-left override in it would reorder that whole line.
 */
const clean = (value: string | undefined, max: number): string => {
  const cleaned = (value ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max).trimEnd()}...`;
};

/**
 * The value becomes an `src` the reader's browser follows, so only a plain https
 * URL survives: a `javascript:` or `data:` picture is the author's code wearing
 * their face, and an http one is blocked as mixed content anyway.
 */
const pictureUrl = (value: string | undefined): string | null => {
  const raw = (value ?? "").trim();
  if (raw === "" || raw.length > MAX_URL) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

export const parseProfile = (input: unknown): Profile | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== PROFILE_KIND) return null;

  let content: unknown;
  try {
    content = JSON.parse(parsed.data.content);
  } catch {
    return null;
  }

  const metadata = metadataSchema.safeParse(content);
  if (!metadata.success) return null;

  const { display_name, displayName, name, picture, nip05, about, lud16, lud06 } = metadata.data;
  return {
    pubkey: parsed.data.pubkey,
    // A blank `display_name` is common, and the author's `name` is what it hides.
    name: clean(display_name ?? displayName, MAX_NAME) || clean(name, MAX_NAME),
    picture: pictureUrl(picture),
    nip05: clean(nip05, MAX_NIP05) || null,
    // Folded to one line: it is drawn as a paragraph, and a profile written as
    // ten lines of Markdown would take over the page it introduces.
    about: clean(about, MAX_ABOUT),
    // Not validated here: what makes one of these usable is a server answering
    // at the end of it, which is `fetchPayEndpoint`'s question rather than this one.
    lud16: clean(lud16, MAX_NIP05) || null,
    lud06: clean(lud06, MAX_URL) || null,
    updatedAt: parsed.data.created_at,
  };
};

/** Indexers serve stale revisions of a profile next to the live one, so the newest wins. */
export const selectProfiles = (events: unknown[]): Map<string, Profile> => {
  const newest = new Map<string, Profile>();
  for (const event of events) {
    const profile = parseProfile(event);
    if (!profile) continue;
    const current = newest.get(profile.pubkey);
    if (!current || profile.updatedAt > current.updatedAt) newest.set(profile.pubkey, profile);
  }
  return newest;
};

const cache = new Map<string, { expiresAt: number; profile: Promise<Profile | null> }>();

export const clearProfileCache = (): void => cache.clear();

export type ProfileOptions = Omit<RelayOptions, "relays"> & { indexers?: string[] };

/**
 * Asked of the indexers alone, which is where profiles are aggregated: paying an
 * outbox lookup for a face would cost more than the face is worth. Cached like a
 * relay list, an author with no profile included, since a page about them would
 * otherwise pay for the same lookup returning nothing.
 */
export const fetchProfiles = async (
  pubkeys: string[],
  options: ProfileOptions = {},
): Promise<Map<string, Profile>> => {
  const now = Date.now();
  const wanted = [...new Set(pubkeys)];
  const missing = wanted.filter((pubkey) => (cache.get(pubkey)?.expiresAt ?? 0) <= now);

  if (missing.length > 0) {
    const pending = queryRelays(
      relaySet(options.indexers ?? INDEXER_RELAYS),
      { kinds: [PROFILE_KIND], authors: missing },
      { ...options, timeoutMs: options.timeoutMs ?? PROFILE_TIMEOUT_MS },
    )
      .then(selectProfiles)
      .catch(() => new Map<string, Profile>());

    for (const pubkey of missing) {
      cache.set(pubkey, {
        expiresAt: now + PROFILE_TTL_MS,
        profile: pending.then((profiles) => profiles.get(pubkey) ?? null),
      });
    }
  }

  const found = await Promise.all(
    wanted.map(async (pubkey) => [pubkey, (await cache.get(pubkey)?.profile) ?? null] as const),
  );
  return new Map(found.filter((entry): entry is [string, Profile] => entry[1] !== null));
};

export const fetchProfile = async (
  pubkey: string,
  options: ProfileOptions = {},
): Promise<Profile | null> => (await fetchProfiles([pubkey], options)).get(pubkey) ?? null;
