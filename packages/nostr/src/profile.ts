import { z } from "zod";
import { type EventDraft, type NostrEvent, newestEvent, nostrEventSchema } from "./event";
import { CLIENT_NAME } from "./nip22";
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
  /** Somewhere else of theirs on the web, which NIP-24 leaves at exactly that. */
  website: string | null;
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
  website: text,
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
export const pictureUrl = (value: string | undefined): string | null => {
  const raw = (value ?? "").trim();
  if (raw === "" || raw.length > MAX_URL) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The value becomes an `href` a reader clicks, so the scheme is the whole of the
 * question: `javascript:` there is the author's code running in the reader's
 * page. http survives where a picture's would not, since a link is followed
 * rather than loaded into this one, and plenty of these were written years ago.
 *
 * A bare host is taken as https, the way `relayUrl` takes one as wss: somebody
 * typing their own address rarely types the scheme.
 */
export const websiteUrl = (value: string | undefined): string | null => {
  const raw = (value ?? "").trim();
  if (raw === "" || raw.length > MAX_URL) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
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

  const { display_name, displayName, name, picture, nip05, website, about, lud16, lud06 } =
    metadata.data;
  return {
    pubkey: parsed.data.pubkey,
    // A blank `display_name` is common, and the author's `name` is what it hides.
    name: clean(display_name ?? displayName, MAX_NAME) || clean(name, MAX_NAME),
    picture: pictureUrl(picture),
    nip05: clean(nip05, MAX_NIP05) || null,
    website: websiteUrl(website),
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

/** What a key says about itself. Only the fields a page here draws. */
export type ProfileDraft = {
  name: string;
  about?: string;
  picture?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
};

/** The live metadata, or nothing at all: a profile nobody can read is one to start over from. */
const liveMetadata = (live: NostrEvent | null): Record<string, unknown> => {
  if (live === null || live.kind !== PROFILE_KIND) return {};
  try {
    const content: unknown = JSON.parse(live.content);
    return typeof content === "object" && content !== null && !Array.isArray(content)
      ? { ...(content as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
};

/**
 * A kind 0 replaces the whole of a profile, every field of it, so an edit starts
 * from the live one and hands back every field it had. Most profiles in the wild
 * carry fields written by clients this one has never heard of, a banner or a
 * birthday, and a save that knew only the six below would delete them.
 *
 * The draft is the whole of what this client has an opinion about: a field left
 * blank in it is cleared rather than left alone. That is the difference between
 * a form and a patch, and this takes a form.
 *
 * The name goes in both `name` and `display_name`: `parseProfile` above prefers
 * the second, half the clients in the wild prefer the first, and a key whose
 * name shows in one client and not the next has published a bug. A camel-cased
 * `displayName` left by another client is dropped for the same reason.
 */
export const editProfile = (live: NostrEvent | null, draft: ProfileDraft): EventDraft => {
  const metadata = liveMetadata(live);

  const name = draft.name.trim();
  delete metadata.displayName;
  if (name === "") {
    delete metadata.name;
    delete metadata.display_name;
  } else {
    metadata.name = name;
    metadata.display_name = name;
  }

  for (const [field, value] of [
    ["about", draft.about],
    ["picture", draft.picture],
    ["nip05", draft.nip05],
    ["website", draft.website],
    ["lud16", draft.lud16],
  ] as const) {
    const trimmed = (value ?? "").trim();
    // Removed rather than written empty: another client reading this cannot tell
    // an empty string from a field somebody meant to clear.
    if (trimmed === "") delete metadata[field];
    else metadata[field] = trimmed;
  }

  return {
    kind: PROFILE_KIND,
    content: JSON.stringify(metadata),
    tags: [...(live?.tags ?? []).filter((tag) => tag[0] !== "client"), ["client", CLIENT_NAME]],
  };
};

/** The same, for a key that has published nothing: there is no live revision to read first. */
export const buildProfile = (draft: ProfileDraft): EventDraft => editProfile(null, draft);

/**
 * What a form editing this profile starts filled with: the fields as they were
 * published, rather than as `parseProfile` shows them. That one folds a
 * description to one line, truncates it and strips what would reorder the line a
 * name sits on, all of which is right for drawing somebody else's profile and
 * wrong for handing an author their own back: a form filled from it would save
 * the truncation over the thing it truncated.
 */
export const profileDraftOf = (live: NostrEvent | null): ProfileDraft => {
  const metadata = liveMetadata(live);
  const field = (name: string): string => {
    const value = metadata[name];
    return typeof value === "string" ? value.trim() : "";
  };

  return {
    name: field("display_name") || field("displayName") || field("name"),
    about: field("about"),
    picture: field("picture"),
    nip05: field("nip05"),
    website: field("website"),
    lud16: field("lud16"),
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

/**
 * The live kind 0, whole and unparsed, for an author about to write one back.
 * Neither cached nor parsed, and both on purpose: the cache above holds the
 * fields a page draws and drops the rest, which is exactly what an edit must not
 * lose, and it holds them for half an hour, which is how old a profile would be
 * before this republished it as current.
 */
export const fetchProfileEvent = async (
  pubkey: string,
  options: ProfileOptions = {},
): Promise<NostrEvent | null> => {
  const events = await queryRelays(
    relaySet(options.indexers ?? INDEXER_RELAYS),
    { kinds: [PROFILE_KIND], authors: [pubkey] },
    { ...options, timeoutMs: options.timeoutMs ?? PROFILE_TIMEOUT_MS },
  ).catch(() => []);
  return newestEvent(events, pubkey, PROFILE_KIND);
};
