import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createLoadCache } from "./cache.server";
import { isPrivateAddress } from "./net";
import { type LinkPreview, parsePreview } from "./preview";

const TIMEOUT_MS = 2500;
const MAX_BYTES = 128 * 1024;
const MAX_REDIRECTS = 2;

const FOUND_MS = 24 * 60 * 60 * 1000;
/** A page that would not answer today may answer tomorrow, so a failure expires sooner. */
const FAILED_MS = 60 * 60 * 1000;

/**
 * Whether this server is allowed to ask that host anything. The check resolves
 * the name and refuses every private range, since a cited link is written by an
 * author and could otherwise point the server at its own network, or at a cloud
 * metadata service, and hand the answer back as a card.
 *
 * A name resolving to a public address at check time and a private one at
 * connect time would still get through. Closing that needs the connection to be
 * pinned to the address checked, which fetch does not offer.
 */
export const isReachable = async (hostname: string): Promise<boolean> => {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) return !isPrivateAddress(bare);
  if (bare === "localhost" || bare.endsWith(".local") || !bare.includes(".")) return false;

  try {
    const addresses = await lookup(bare, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
};

/** Only the head is wanted, so the body is read up to a bound and then dropped. */
const readHead = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let html = "";
  let read = 0;
  while (read < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    html += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return html;
};

/**
 * Redirects are followed by hand rather than by fetch, so that every hop is
 * checked against the same rule as the first, and only a couple are allowed.
 */
const fetchPage = async (target: string): Promise<LinkPreview | null> => {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!(await isReachable(url.hostname))) return null;

    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "OpenSpecs" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!response) return null;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) return null;
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    // The card names the address the document cited, not where it ended up.
    return parsePreview(await readHead(response), target);
  }

  return null;
};

const cache = createLoadCache<LinkPreview | null>({
  max: 500,
  ttlMs: FOUND_MS,
  ttlMsFor: (preview) => (preview === null ? FAILED_MS : FOUND_MS),
});

export const loadLinkPreview = (url: string): Promise<LinkPreview | null> =>
  cache.get(url, () => fetchPage(url).catch(() => null));

const SHOWN = 6;
/**
 * How long a page waits on hosts it does not control. The fetch it started keeps
 * going and fills the cache, so a link missing its card here has one on the next
 * request, and the reader never waits on a slow third party twice.
 */
const DEADLINE_MS = 1000;

const withDeadline = <T>(work: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), DEADLINE_MS).unref();
    }),
  ]);

export const loadLinkPreviews = async (urls: string[]): Promise<LinkPreview[]> => {
  const previews = await Promise.all(
    urls.slice(0, SHOWN).map((url) => withDeadline(loadLinkPreview(url), null)),
  );
  return previews.filter((preview): preview is LinkPreview => preview !== null);
};
