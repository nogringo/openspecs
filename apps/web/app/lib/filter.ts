export type SpecFilterParams = { topic?: string; kind?: number };

const TOPIC = /^[a-z0-9][a-z0-9\-_.]{0,63}$/;
const KIND = /^\d{1,7}$/;
const PAGE = /^\d{1,3}$/;
/** Long enough for a sentence, short enough that a URL stays a URL. */
const MAX_QUERY = 100;

/**
 * What a visitor typed only becomes a relay filter once it looks like one.
 * Anything else is dropped rather than forwarded, and the caller's canonical URL
 * is built back from what survives here, so one listing is never indexed under a
 * dozen spellings of the same query.
 */
export const parseSpecFilter = (params: URLSearchParams): SpecFilterParams => {
  const topic = params.get("topic")?.trim().toLowerCase() ?? "";
  const kind = params.get("kind")?.trim() ?? "";
  return {
    ...(TOPIC.test(topic) && { topic }),
    ...(KIND.test(kind) && { kind: Number(kind) }),
  };
};

/**
 * Anything that is not a page number is page one, on the same rule as the filter
 * above: the caller rebuilds its canonical URL from what survived here, so a
 * listing is never indexed under a dozen spellings of its first page.
 */
export const parsePage = (params: URLSearchParams): number => {
  const page = params.get("page")?.trim() ?? "";
  return PAGE.test(page) ? Math.max(1, Number(page)) : 1;
};

/**
 * Kept apart from the filter above, which relays are asked: this one never
 * reaches a relay, and never reaches a feed either. It is tidied rather than
 * validated, since any word a reader types is a legitimate thing to look for.
 */
export const parseSearchQuery = (params: URLSearchParams): string | undefined => {
  const query = (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return query === "" ? undefined : query;
};
