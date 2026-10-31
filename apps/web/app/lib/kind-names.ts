type Declaring = { kinds: { raw: string; name: string | null }[] };

/**
 * What each kind is called by the documents that declare it, keyed by its `k`
 * value. The most used name wins, so one document naming a kind oddly does not
 * rename it for everybody, and ties are broken alphabetically as topics are.
 */
export const kindNames = (documents: Declaring[]): Map<string, string> => {
  const counts = new Map<string, Map<string, number>>();
  for (const document of documents) {
    for (const { raw, name } of document.kinds) {
      if (name === null) continue;
      const named = counts.get(raw) ?? new Map<string, number>();
      named.set(name, (named.get(name) ?? 0) + 1);
      counts.set(raw, named);
    }
  }

  const names = new Map<string, string>();
  for (const [raw, named] of counts) {
    const [first] = [...named].sort(([leftName, left], [rightName, right]) =>
      right === left ? leftName.localeCompare(rightName) : right - left,
    );
    if (first !== undefined) names.set(raw, first[0]);
  }
  return names;
};

/** The one kind called that, or null when none is or when several share the name. */
export const kindNamed = (names: Map<string, string>, name: string): string | null => {
  let found: string | null = null;
  for (const [raw, called] of names) {
    if (called !== name) continue;
    if (found !== null) return null;
    found = raw;
  }
  return found;
};
