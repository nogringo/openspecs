export type OpeningHeading = { depth: number; text: string };

// A title tag may carry the backticks its heading renders away: "NIP-07: `window.nostr` ...".
const normalizeTitle = (text: string): string =>
  text.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * How many of a document's opening headings repeat the page title, which the
 * page already shows above them. Either one heading saying the whole title, or
 * the NIP habit of a number over a name: "NIP-59", then "Gift Wrap", under the
 * title "NIP-59: Gift Wrap". The number goes on its own when the name below it
 * is not the one in the title, since that name still says something.
 */
export const repeatedTitleHeadings = (
  title: string,
  first: OpeningHeading | undefined,
  second: OpeningHeading | undefined,
): number => {
  if (first?.depth !== 1) return 0;
  const whole = normalizeTitle(title);
  const opening = normalizeTitle(first.text);
  if (opening === "") return 0;
  if (opening === whole) return 1;
  if (!whole.startsWith(`${opening}:`)) return 0;
  return second?.depth === 2 && `${opening}: ${normalizeTitle(second.text)}` === whole ? 2 : 1;
};
