import { Link } from "react-router";
import { SearchBox } from "./search-box";

export const SOURCE_URL = "https://github.com/nogringo/openspecs";

/** GitHub's own mark, so the link is recognised before it is read. */
const GithubMark = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.77-.26-1.27-.55-1.52 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
  </svg>
);

export const Shell = ({
  children,
  search = true,
  query,
}: {
  children: React.ReactNode;
  /** The home page carries its own, so the header does not repeat it. */
  search?: boolean;
  query?: string;
}) => (
  <div className="min-h-dvh bg-paper text-ink">
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4">
        <Link to="/" className="shrink-0 font-mono text-xs uppercase tracking-[0.2em]">
          Open Specs
        </Link>
        {search ? (
          <div className="max-w-xs flex-1">
            <SearchBox query={query} />
          </div>
        ) : null}
        <div className="flex items-center gap-5 font-mono text-[0.6875rem] uppercase tracking-[0.16em]">
          {search ? null : <p className="hidden text-muted sm:block">Signed and stored on Nostr</p>}
          {/* No nofollow: this one link is the project's own, and it is meant to be followed. */}
          <a
            href={SOURCE_URL}
            rel="noopener noreferrer"
            title="Source on GitHub"
            className="inline-flex items-center gap-2 text-muted hover:text-ink"
          >
            <GithubMark />
            <span>Source</span>
          </a>
        </div>
      </div>
    </div>
    {children}
  </div>
);
