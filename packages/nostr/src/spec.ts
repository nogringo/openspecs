import { allTags, type NostrEvent, nostrEventSchema, SPEC_KIND, tagValue } from "./event";
import { deriveSummary, firstHeading } from "./markdown";

export type SpecKindRef = {
  /** The `k` value exactly as published. Not always a number. */
  raw: string;
  kind: number | null;
  name: string | null;
};

export type SpecFork =
  | { type: "spec"; coordinate: string; relay: string | null }
  | { type: "external"; url: string };

export type Spec = {
  event: NostrEvent;
  pubkey: string;
  identifier: string;
  title: string;
  /** True when no usable `title` tag was published and the title had to be inferred. */
  titleIsDerived: boolean;
  summary: string;
  /**
   * True when no `summary` tag was published and the description had to be taken
   * from the document itself. Such a summary is written for crawlers, not for
   * readers: showing it above the document repeats its opening paragraph.
   */
  summaryIsDerived: boolean;
  content: string;
  kinds: SpecKindRef[];
  topics: string[];
  status: string | null;
  createdAt: number;
  publishedAt: number;
  forks: SpecFork[];
  /**
   * Nothing to render. Parsing still succeeds: a blank document is a real
   * document its author has not written yet, and rejecting it here would also
   * reject drafts. Listings, feeds and the sitemap are what filter it out.
   */
  isEmpty: boolean;
};

const humanize = (identifier: string): string => {
  const words = identifier
    .replace(/[-_:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words === "" ? "" : words.charAt(0).toUpperCase() + words.slice(1);
};

const parseKinds = (event: NostrEvent): SpecKindRef[] =>
  allTags(event, "k")
    .map((tag) => {
      const raw = (tag[1] ?? "").trim();
      const name = (tag[2] ?? "").trim();
      return {
        raw,
        kind: /^\d+$/.test(raw) ? Number(raw) : null,
        name: name === "" ? null : name,
      };
    })
    .filter((ref) => ref.raw !== "");

const parseForks = (event: NostrEvent): SpecFork[] => {
  const forks: SpecFork[] = [];
  // The marker sits at a different index on each tag: `a` reserves index 2 for
  // a relay hint, `i` does not.
  for (const tag of allTags(event, "a")) {
    const coordinate = (tag[1] ?? "").trim();
    if (tag[3] === "fork" && coordinate !== "") {
      forks.push({ type: "spec", coordinate, relay: (tag[2] ?? "").trim() || null });
    }
  }
  for (const tag of allTags(event, "i")) {
    const url = (tag[1] ?? "").trim();
    if (tag[2] === "fork" && url !== "") forks.push({ type: "external", url });
  }
  return forks;
};

/**
 * Returns null for anything that is not a specification.
 *
 * Kind 30817 is shared with at least one unrelated application publishing a
 * different schema on it, so tolerating every missing field would turn its
 * events into blank pages in the index. An addressable document with no
 * identifier is not a document, which is the line drawn here.
 */
export const parseSpec = (input: unknown): Spec | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success) return null;

  const event = parsed.data;
  if (event.kind !== SPEC_KIND) return null;

  const identifier = tagValue(event, "d");
  if (identifier === "") return null;

  const content = event.content;
  const titleTag = tagValue(event, "title");
  const derived = titleTag === "" ? (firstHeading(content) ?? humanize(identifier)) : "";
  const summaryTag = tagValue(event, "summary");
  const publishedAt = Number(tagValue(event, "published_at"));

  return {
    event,
    pubkey: event.pubkey,
    identifier,
    title: titleTag === "" ? derived : titleTag,
    titleIsDerived: titleTag === "",
    summary: summaryTag || deriveSummary(content),
    summaryIsDerived: summaryTag === "",
    content,
    kinds: parseKinds(event),
    topics: allTags(event, "t")
      .map((tag) => (tag[1] ?? "").trim().toLowerCase())
      .filter((topic) => topic !== ""),
    status: tagValue(event, "status") || null,
    createdAt: event.created_at,
    publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : event.created_at,
    forks: parseForks(event),
    isEmpty: content.trim() === "",
  };
};
