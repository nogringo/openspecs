import { startCorpus } from "~/lib/corpus";
import { specsPath } from "~/lib/paths";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 text-ink placeholder:text-muted hover:border-muted";

/**
 * A GET form, so a search is a URL a reader can share, bookmark and go back to.
 * There is no `action` export behind it: the query is answered in the browser,
 * against a corpus it downloaded from the relays itself.
 *
 * Focus is what starts that download. A reader who never searches never pays for
 * the search, and one who is about to has the corpus on its way before the first
 * word is typed.
 */
export const SearchBox = ({
  query,
  size = "compact",
}: {
  query?: string;
  size?: "compact" | "hero";
}) => (
  <search className="block w-full">
    <form method="get" action={specsPath()}>
      <label className="sr-only" htmlFor={`search-${size}`}>
        Search specifications
      </label>
      <input
        id={`search-${size}`}
        type="search"
        name="q"
        defaultValue={query ?? ""}
        onFocus={startCorpus}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search specifications"
        className={
          size === "hero"
            ? `${FIELD} py-3 font-mono text-base`
            : `${FIELD} py-1.5 font-mono text-xs tracking-normal normal-case`
        }
      />
    </form>
  </search>
);
