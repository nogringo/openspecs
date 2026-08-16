export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  description: string;
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16) || 32);
      }
      if (body.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10) || 32);
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      return named[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();

const meta = (html: string, name: string): string => {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const reversed = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`,
    "i",
  );
  return decodeEntities(pattern.exec(html)?.[1] ?? reversed.exec(html)?.[1] ?? "");
};

/** `max` counts the ellipsis, so a card can be laid out on a known width. */
const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;

/**
 * Read with regular expressions rather than a parser: only four fields are
 * wanted, out of the head of a page this project does not control, and the cost
 * of being wrong is a card without a description.
 *
 * No image is read. Rendering a remote one would hand the reader's address to
 * whatever host an author cited, which is not a trade a reader agreed to.
 */
export const parsePreview = (html: string, url: string): LinkPreview | null => {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }

  const head = html.slice(0, 64 * 1024);
  const title =
    meta(head, "og:title") ||
    meta(head, "twitter:title") ||
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "");
  if (title === "") return null;

  return {
    url,
    host: host.replace(/^www\./, ""),
    title: truncate(title, 120),
    description: truncate(
      meta(head, "og:description") ||
        meta(head, "twitter:description") ||
        meta(head, "description"),
      200,
    ),
  };
};
