export type SpecsQuery = { topic?: string; kind?: string | number };

export const specsPath = (query: SpecsQuery = {}): string => {
  const params = new URLSearchParams();
  if (query.topic) params.set("topic", query.topic);
  if (query.kind !== undefined && query.kind !== "") params.set("kind", String(query.kind));
  const search = params.toString();
  return search === "" ? "/specs" : `/specs?${search}`;
};
