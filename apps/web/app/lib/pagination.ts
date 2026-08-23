export type Paged<T> = { items: T[]; page: number; pages: number; total: number };

/**
 * The page asked for is clamped rather than refused: a number past the end is
 * usually a listing that shrank since the link was made, and a redirect derived
 * from a window that moves every minute would outlive the window itself. An
 * empty listing is still page one of one, so a caller never has to special-case
 * having nothing.
 */
export const pageOf = <T>(items: T[], page: number, size: number): Paged<T> => {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pages,
    total: items.length,
  };
};
