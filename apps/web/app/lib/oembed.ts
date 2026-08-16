export type SpecUrl = { npub: string; identifier: string };

/**
 * The document a consumer is asking about, read back out of its own URL.
 * Only URLs served here are answered for: an oEmbed endpoint that describes
 * someone else's page is an open proxy, not a provider.
 */
export const parseSpecUrl = (url: string, origin: string): SpecUrl | null => {
  let target: URL;
  let home: URL;
  try {
    target = new URL(url);
    home = new URL(origin);
  } catch {
    return null;
  }
  if (target.origin !== home.origin) return null;

  const [, section, npub, ...rest] = target.pathname.split("/");
  if (section !== "spec" || !npub?.startsWith("npub1") || rest.length === 0) return null;

  // An identifier may hold a slash, encoded, so the tail is joined back together.
  const identifier = decodeURIComponent(rest.join("/"));
  return identifier === "" ? null : { npub, identifier };
};
