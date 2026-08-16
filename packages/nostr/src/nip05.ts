import { z } from "zod";

export const NIP05_TIMEOUT_MS = 2000;
const NIP05_TTL_MS = 10 * 60 * 1000;

/** The local part NIP-05 allows, plus `_` for a bare domain. */
const NAME = /^[a-z0-9\-_.]+$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export type Nip05Address = { name: string; domain: string };

export type Nip05Result = {
  pubkey: string;
  /** Relay hints the domain publishes for that key, which are only hints. */
  relays: string[];
};

/**
 * Accepts `name@domain` and a bare `domain`, which NIP-05 defines as the name
 * `_`. Everything is lowercased: the local part is case sensitive in principle,
 * but published names are lowercase in practice and URLs are not.
 */
export const parseNip05Address = (input: string): Nip05Address | null => {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^nostr:/, "");
  const parts = value.split("@");
  if (parts.length > 2) return null;

  const name = parts.length === 2 ? (parts[0] ?? "") : "_";
  const domain = parts[parts.length - 1] ?? "";
  if (!NAME.test(name) || !DOMAIN.test(domain)) return null;
  return { name, domain };
};

const responseSchema = z.object({
  names: z.record(z.string(), z.string()).optional(),
  relays: z.record(z.string(), z.array(z.string())).optional(),
});

const cache = new Map<string, { expiresAt: number; result: Promise<Nip05Result | null> }>();

export const clearNip05Cache = (): void => cache.clear();

export type Nip05Options = { timeoutMs?: number };

/**
 * A domain is user supplied, so this server is being asked to make a request on
 * a stranger's behalf: https only, no redirects, which NIP-05 forbids anyway, a
 * short timeout, and no local hostname. A name that does not resolve is cached
 * like one that does, otherwise every hit on a bad link pays the same round trip.
 */
const query = async (address: Nip05Address, options: Nip05Options): Promise<Nip05Result | null> => {
  const url = `https://${address.domain}/.well-known/nostr.json?name=${encodeURIComponent(address.name)}`;
  try {
    const response = await fetch(url, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? NIP05_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    const pubkey = parsed.data.names?.[address.name]?.trim().toLowerCase();
    if (!pubkey || !HEX_64.test(pubkey)) return null;
    return { pubkey, relays: parsed.data.relays?.[pubkey] ?? [] };
  } catch {
    return null;
  }
};

export const resolveNip05 = (
  input: string,
  options: Nip05Options = {},
): Promise<Nip05Result | null> => {
  const address = parseNip05Address(input);
  if (address === null) return Promise.resolve(null);
  if (address.domain === "localhost" || address.domain.endsWith(".local")) {
    return Promise.resolve(null);
  }

  const key = `${address.name}@${address.domain}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const result = query(address, options);
  cache.set(key, { expiresAt: now + NIP05_TTL_MS, result });
  return result;
};
