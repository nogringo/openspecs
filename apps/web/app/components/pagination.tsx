import { Link } from "react-router";

/** Beyond this many, the numbers are thinned to the ends and the neighbourhood. */
const SHOWN = 7;

/** A number to offer, or the run of them left out in front of the next one. */
type Cell = { page: number } | { gapBefore: number };

const cells = (page: number, pages: number): Cell[] => {
  if (pages <= SHOWN) return Array.from({ length: pages }, (_, index) => ({ page: index + 1 }));

  const near = [page - 1, page, page + 1].filter((n) => n > 1 && n < pages);
  const shown = [1, ...near, pages];

  return shown.flatMap((n, index): Cell[] => {
    const previous = shown[index - 1];
    if (previous === undefined || n === previous + 1) return [{ page: n }];
    // A gap of exactly one page is spelled out instead: an ellipsis standing in
    // for a single number is longer than the number and hides the way to it.
    return n === previous + 2
      ? [{ page: previous + 1 }, { page: n }]
      : [{ gapBefore: n }, { page: n }];
  });
};

const CELL = "rounded-sm px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em]";
const LINK = `${CELL} text-muted hover:text-ink`;

const Step = ({ to, rel, children }: { to: string | null; rel: string; children: string }) =>
  to === null ? (
    // An end of the list, kept in place so the numbers between the two steps do
    // not shift sideways as a reader walks the pages.
    <span className={`${CELL} text-rule`} aria-hidden="true">
      {children}
    </span>
  ) : (
    <Link to={to} rel={rel} className={LINK}>
      {children}
    </Link>
  );

export const Pagination = ({
  page,
  pages,
  href,
  label,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  /** What is being paged through, for a reader who lands on the control itself. */
  label: string;
}) => {
  if (pages <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="mt-10 flex flex-wrap items-center justify-center gap-1 border-t border-rule pt-8"
    >
      <Step to={page > 1 ? href(page - 1) : null} rel="prev">
        ← Previous
      </Step>

      {cells(page, pages).map((cell) => {
        if ("gapBefore" in cell) {
          return (
            <span key={`gap-${cell.gapBefore}`} className={`${CELL} text-muted`} aria-hidden="true">
              ...
            </span>
          );
        }
        return cell.page === page ? (
          <span key={cell.page} aria-current="page" className={`${CELL} bg-ink text-paper`}>
            {cell.page}
          </span>
        ) : (
          <Link
            key={cell.page}
            to={href(cell.page)}
            aria-label={`Page ${cell.page}`}
            className={LINK}
          >
            {cell.page}
          </Link>
        );
      })}

      <Step to={page < pages ? href(page + 1) : null} rel="next">
        Next →
      </Step>
    </nav>
  );
};
