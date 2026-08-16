/**
 * A missing document must stay cacheable: a crawler walking dead links would
 * otherwise put a relay query behind every one of them. Kept short, because the
 * document may be published a minute later.
 */
export const NOT_FOUND_HEADERS = { "Cache-Control": "public, max-age=0, s-maxage=30" };

/**
 * Read by the shared cache in front of the app, not by the browser: a reader
 * coming back to a page should see the revision that is live now, while a crawler
 * hitting a popular document should not cost a relay query.
 */
export const PAGE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
};
