import { Link } from "react-router";
import { aboutPath, atomPath, newSpecPath, rssPath } from "~/lib/paths";
import { Identity } from "./identity";
import { Bell } from "./notifications/bell";
import { SearchBox } from "./search-box";

export const SOURCE_URL = "https://github.com/nogringo/openspecs";

/** GitHub's own mark, so the link is recognised before it is read. */
const GithubMark = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.77-.26-1.27-.55-1.52 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
  </svg>
);

/**
 * What is about this site rather than in it: what it does with the documents it
 * shows, the code that does it, and the feeds. None of them is a control a
 * reader reaches for while reading, and the line at the top is for the ones that
 * are.
 */
const Footer = () => (
  <footer className="border-t border-rule">
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:px-6">
      {/* Not what the home page says in its own words above the fold: this is
          the sentence every other page needs, and the one the source link
          beside it makes good on. */}
      <p className="max-w-md font-serif text-[0.8125rem] leading-relaxed text-muted">
        This site is one way to read these documents, not where they live. The relays keep them
        whether it runs or not.
      </p>
      <nav className="flex flex-wrap items-center gap-4 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted sm:gap-5">
        <Link to={aboutPath()} className="hover:text-ink">
          About
        </Link>
        {/* No nofollow: this one link is the project's own, and it is meant to be followed. */}
        <a
          href={SOURCE_URL}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 hover:text-ink"
        >
          <GithubMark />
          Source
        </a>
        {/* Anchors rather than links: both are XML off a resource route, and a
            client side navigation to one has nothing to render. */}
        <a href={rssPath()} className="hover:text-ink">
          RSS
        </a>
        <a href={atomPath()} className="hover:text-ink">
          Atom
        </a>
      </nav>
    </div>
  </footer>
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
  <div className="flex min-h-dvh flex-col bg-paper text-ink">
    <header className="border-b border-rule">
      {/* More wants this line than a phone has room for, so the gaps close first,
          then the words beside the marks go. */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6">
        <Link
          to="/"
          className="shrink-0 font-mono text-xs uppercase tracking-[0.14em] sm:tracking-[0.2em]"
        >
          Open Specs
        </Link>
        {search ? (
          <div className="min-w-0 max-w-xs flex-1">
            <SearchBox query={query} />
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-3 font-mono text-[0.6875rem] uppercase tracking-[0.16em] sm:gap-5">
          {/* Said again here, outside the panel that holds the other one: that
              panel only offers it once a key is connected, and this is the door
              somebody who has none has to be able to see. */}
          <Link to={newSpecPath()} className="hidden text-muted hover:text-ink sm:block">
            Write
          </Link>
          {/* The reader's own two controls, held as one. The width reserved for
              them is on the pair rather than on either, so the slack a short name
              leaves falls outside the two and never between them. */}
          <div className="flex shrink-0 items-center justify-end gap-3 sm:min-w-24 sm:gap-5">
            <Bell />
            <Identity />
          </div>
        </div>
      </div>
    </header>
    <div className="flex-1">{children}</div>
    <Footer />
  </div>
);
