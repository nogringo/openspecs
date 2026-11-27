import { specsPath } from "~/lib/paths";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 text-ink placeholder:text-muted hover:border-muted";

/**
 * A GET form, so a search is a URL a reader can share, bookmark and go back to,
 * answered by the listing's loader like any other page of it.
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
