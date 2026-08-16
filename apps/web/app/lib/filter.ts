export type SpecFilterParams = { topic?: string; kind?: number };

const TOPIC = /^[a-z0-9][a-z0-9\-_.]{0,63}$/;
const KIND = /^\d{1,7}$/;

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
