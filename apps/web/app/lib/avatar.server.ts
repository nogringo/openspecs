import { createLoadCache } from "./cache.server";
import { isReachable } from "./preview.server";

const TIMEOUT_MS = 2500;
/**
 * Wide enough for the unoptimised photographs profiles actually carry, since a
 * face lost to a bound is a face lost for nothing. What it still refuses is the
 * multi megabyte animation, which is a video wearing an avatar's clothes. The
 * timeout is the real bound anyway: bytes that do not arrive in time never do.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 2;

/**
 * A picture is kept only long enough to collapse the cards drawn in one burst,
 * an author's own and that of every document they signed. Beyond that the drawn
 * card is on disk and the bytes would sit in memory for nobody.
 */
const FOUND_MS = 5 * 60 * 1000;
/** A host that would not answer now may answer in an hour. */
const FAILED_MS = 60 * 60 * 1000;
/** A verdict costs nothing to hold, and a format does not change under a URL. */
const SETTLED_MS = 24 * 60 * 60 * 1000;

/**
 * A picture and whether anything is expected to change. Only a host that failed
 * to answer is worth coming back to: a format nothing here can draw, or bytes
 * beyond the bound, are answers, and they will be the same tomorrow.
 */
export type Avatar = { uri: string | null; retry: boolean };

const NONE: Avatar = { uri: null, retry: false };
const LATER: Avatar = { uri: null, retry: true };

/**
 * What the renderer was checked to rasterise, and nothing more: it draws a
 * format it does not understand as a hole in the card rather than failing, so
 * webp and avif are left to the key mark instead. Both are common on profiles.
 */
const DRAWABLE = new Set(["image/png", "image/jpeg", "image/gif"]);

/**
 * Read up to a bound and no further. A truncated picture is not a picture, so
 * passing the bound is a failure rather than a smaller image.
 */
const readImage = async (response: Response): Promise<Uint8Array | null> => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  const reader = declared > MAX_BYTES ? null : response.body?.getReader();
  if (!reader) {
    await response.body?.cancel().catch(() => {});
    return null;
  }

  const chunks: Uint8Array[] = [];
  let read = 0;
  while (read < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      const image = new Uint8Array(read);
      let at = 0;
      for (const chunk of chunks) {
        image.set(chunk, at);
        at += chunk.byteLength;
      }
      return image;
    }
    read += value.byteLength;
    chunks.push(value);
  }

  await reader.cancel().catch(() => {});
  return null;
};

/**
 * Fetched here rather than by the renderer, which would follow the same URL with
 * no timeout, no bound and no check on where it points. The address comes out of
 * a profile, so it is a stranger's text telling this server what to ask for.
 *
 * Redirects are followed by hand, so every hop is held to the rule the first one
 * was: https only, since a profile picture that is not https is dropped when the
 * profile is parsed, and never a host on this server's own network.
 */
const fetchAvatar = async (target: string): Promise<Avatar> => {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return NONE;
    }
    if (url.protocol !== "https:") return NONE;
    if (!(await isReachable(url.hostname))) return LATER;

    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: [...DRAWABLE].join(","), "user-agent": "OpenSpecs" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!response) return LATER;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) return NONE;
      current = new URL(location, url).toString();
      continue;
    }

    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return LATER;
    }
    if (type === undefined || !DRAWABLE.has(type)) {
      await response.body?.cancel().catch(() => {});
      return NONE;
    }

    const image = await readImage(response);
    return image === null
      ? NONE
      : { uri: `data:${type};base64,${Buffer.from(image).toString("base64")}`, retry: false };
  }

  return NONE;
};

/**
 * Few entries, because one of them is a whole photograph: what is worth holding
 * is the answer, and the answers that weigh nothing are the ones held longest.
 */
const cache = createLoadCache<Avatar>({
  max: 8,
  ttlMs: FOUND_MS,
  ttlMsFor: (avatar) => {
    if (avatar.retry) return FAILED_MS;
    return avatar.uri === null ? SETTLED_MS : FOUND_MS;
  },
});

/**
 * The author's picture as bytes a card can carry, so the renderer never reaches
 * the network. Nothing wherever it cannot be drawn, which the card reads as an
 * author who published no picture at all.
 */
export const loadAvatar = (picture: string | null | undefined): Promise<Avatar> =>
  picture
    ? cache.get(picture, () => fetchAvatar(picture).catch(() => LATER))
    : Promise.resolve(NONE);
