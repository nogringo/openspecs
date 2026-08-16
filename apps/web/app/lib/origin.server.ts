const forwarded = (request: Request, header: string): string | null =>
  request.headers.get(header)?.split(",")[0]?.trim() || null;

/**
 * The origin pages are published under, which the server cannot read off the
 * request: behind a reverse proxy it only ever sees its own loopback address,
 * and a canonical URL pointing at 127.0.0.1 is worse than none.
 *
 * `OPENSPECS_PUBLIC_URL` states it. Without it the forwarded headers a proxy
 * sets are the next best answer, and the request itself the last, which is what
 * makes the app run unconfigured in development. A malformed value falls back
 * the same way rather than taking the page down with it.
 */
export const publicOrigin = (request: Request): string => {
  const configured = process.env.OPENSPECS_PUBLIC_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {}
  }

  const url = new URL(request.url);
  const protocol = forwarded(request, "x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = forwarded(request, "x-forwarded-host") ?? url.host;
  return `${protocol}://${host}`;
};
