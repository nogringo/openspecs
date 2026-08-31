import { toCoordinate } from "./address";
import {
  allTags,
  type EventDraft,
  type NostrEvent,
  nostrEventSchema,
  SPEC_KIND,
  tagValue,
} from "./event";
import { deriveSummary, firstHeading } from "./markdown";
import { CLIENT_NAME } from "./nip22";
import { DELETION_KIND } from "./nip25";

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
  /** Read from `s` before `status`: the schema names neither, and `s` is the one in the wild. */
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
    status: tagValue(event, "s") || tagValue(event, "status") || null,
    createdAt: event.created_at,
    publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : event.created_at,
    forks: parseForks(event),
    isEmpty: content.trim() === "",
  };
};

/** A `k` tag as it will be written: the value, and the name that may follow it. */
export type SpecKindEntry = { raw: string; name: string };

/**
 * The whole of what this editor has an opinion about. Every field is required
 * and a blank one clears its tag, which is the difference between a form and a
 * patch, and this takes a form.
 */
export type SpecDraft = {
  identifier: string;
  title: string;
  summary: string;
  content: string;
  status: string;
  /** In the order they were published, and not folded to lower case. */
  topics: string[];
  kinds: SpecKindEntry[];
};

const EMPTY_DRAFT: SpecDraft = {
  identifier: "",
  title: "",
  summary: "",
  content: "",
  status: "",
  topics: [],
  kinds: [],
};

/**
 * What a form editing this document starts filled with: the fields as they were
 * published, rather than as a page shows them. `parseSpec` invents a title from
 * the first heading, cuts a description to a hundred and sixty characters and
 * folds topics to lower case, all of which is right for drawing somebody else's
 * document and wrong for handing an author their own back. A form filled from it
 * would publish the invention over the thing it stood in for.
 */
export const specDraftOf = (live: NostrEvent | null): SpecDraft => {
  const parsed = nostrEventSchema.safeParse(live);
  if (!parsed.success || parsed.data.kind !== SPEC_KIND) return EMPTY_DRAFT;

  const event = parsed.data;
  const identifier = tagValue(event, "d");
  if (identifier === "") return EMPTY_DRAFT;

  return {
    identifier,
    title: tagValue(event, "title"),
    summary: tagValue(event, "summary"),
    content: event.content,
    status: tagValue(event, "s") || tagValue(event, "status"),
    topics: allTags(event, "t")
      .map((tag) => (tag[1] ?? "").trim())
      .filter((topic) => topic !== ""),
    kinds: parseKinds(event).map((ref) => ({ raw: ref.raw, name: ref.name ?? "" })),
  };
};

/**
 * Every tag this editor decides. Anything else on the live event is another
 * client's, and is copied through untouched: the fork markers, the pages and
 * icons of a documentation space, the `update` and `extends` of a proposal. A
 * save that knew only the fields below would delete them.
 */
const OWNED = new Set(["d", "title", "summary", "published_at", "s", "status", "t", "k", "alt"]);

/**
 * Kept from the live event, or taken from when it was first signed. Never set on
 * a first publish: `created_at` is stamped at signing time, seconds or minutes
 * after this runs, so a moment computed here would land before it and the
 * document would show a revision date on the day it was written.
 */
const publishedAt = (live: NostrEvent): string[][] => {
  const published = tagValue(live, "published_at");
  const seconds = Number(published);
  return [
    ["published_at", Number.isFinite(seconds) && seconds > 0 ? published : `${live.created_at}`],
  ];
};

/**
 * A document replaces the whole of its previous revision, so an edit starts from
 * the live one and hands back every tag it had.
 *
 * The status is written as `s` and only as `s`. The schema names no status tag
 * at all, and the one client publishing them writes `s`, so this reads both and
 * sends the one that already exists. A `status` left by anyone else is removed
 * rather than kept, or a document would carry two of them and show a different
 * answer on each site rendering it.
 */
export const editSpec = (live: NostrEvent | null, draft: SpecDraft): EventDraft => {
  const identifier = draft.identifier.trim();
  const title = draft.title.trim();
  const summary = draft.summary.trim();
  const status = draft.status.trim();

  const topics: string[] = [];
  for (const topic of draft.topics) {
    const trimmed = topic.trim();
    if (trimmed !== "" && !topics.includes(trimmed)) topics.push(trimmed);
  }

  return {
    kind: SPEC_KIND,
    content: draft.content,
    tags: [
      ["d", identifier],
      // Removed rather than written empty: another client reading this cannot
      // tell an empty string from a field somebody meant to clear.
      ...(title === "" ? [] : [["title", title]]),
      ...(summary === "" ? [] : [["summary", summary]]),
      ...(live === null ? [] : publishedAt(live)),
      ...(status === "" ? [] : [["s", status]]),
      ...topics.map((topic) => ["t", topic]),
      ...draft.kinds
        .filter((entry) => entry.raw.trim() !== "")
        .map((entry) =>
          entry.name.trim() === ""
            ? ["k", entry.raw.trim()]
            : ["k", entry.raw.trim(), entry.name.trim()],
        ),
      ...(live?.tags ?? []).filter((tag) => {
        const name = tag[0] ?? "";
        return name !== "" && name !== "client" && !OWNED.has(name);
      }),
      // NIP-31, for the clients that do not know this kind. Owned rather than
      // preserved: an alt naming the previous title is worse than none.
      ["alt", `A specification: ${title || identifier}`],
      ["client", CLIENT_NAME],
    ],
  };
};

/** The same, for a document nobody has published yet: there is no live revision to read first. */
export const buildSpec = (draft: SpecDraft): EventDraft => editSpec(null, draft);

/** The document a fork came from, as the marker naming it will be written. */
export type ForkOrigin = {
  pubkey: string;
  identifier: string;
  /** A relay it is known to sit on. The slot is positional, so an empty one is still written. */
  relay?: string | null;
};

/**
 * A document somebody starts from another key's, carrying one tag that says
 * where it came from.
 *
 * Built from the draft and never from the origin's event. `editSpec(origin, draft)`
 * looks like the way to do this and is the trap: it hands back every tag it does
 * not own, so the other author's `published_at` and whatever else they wrote
 * would travel into a document signed by somebody else.
 *
 * The marker is written here and never again. Every later revision of the fork
 * goes through `editSpec`, which copies an `a` tag through with everything else
 * this editor has no opinion about, so a fork renamed a year later still names
 * the document it came from rather than the name it used to have.
 */
export const forkSpec = (origin: ForkOrigin, forker: string, draft: SpecDraft): EventDraft => {
  const event = buildSpec(draft);
  const pubkey = origin.pubkey.trim();
  const identifier = origin.identifier.trim();
  // A marker pointing at the document being built says nothing, and drawn on a
  // page it is a link back to the page you are on.
  const itself = pubkey === forker && identifier === draft.identifier.trim();
  if (pubkey === "" || identifier === "" || itself) return event;

  const marker = ["a", toCoordinate({ pubkey, identifier }), origin.relay?.trim() ?? "", "fork"];
  // Where `editSpec` puts the foreign tags it carries through, so a fork and its
  // own later revisions order their tags the same way.
  const alt = event.tags.findIndex((tag) => tag[0] === "alt");
  const at = alt === -1 ? event.tags.length : alt;
  return { ...event, tags: [...event.tags.slice(0, at), marker, ...event.tags.slice(at)] };
};

/**
 * The empty revision an author replaces their own document with, and the first
 * half of withdrawing it.
 *
 * Nothing of the live event is carried over, which is the whole point and also
 * why this needs no live event to build: a `d` is what makes the address, and
 * everything else was the document. A relay that never honours the deletion
 * request below keeps serving this instead, and what it serves is blank rather
 * than the document. `isEmpty` is then what drops it from every listing.
 */
export const withdrawSpec = (identifier: string): EventDraft => ({
  kind: SPEC_KIND,
  content: "",
  tags: [
    ["d", identifier.trim()],
    ["client", CLIENT_NAME],
  ],
});

/**
 * NIP-09, and the second half: the request that the revisions above be forgotten.
 *
 * An `a` and never an `e`. A relay honouring `a` drops every revision at the
 * coordinate up to this request's `created_at`, the empty one included, and the
 * document 404s. A relay that only understands `e` would instead drop whichever
 * single revision was named and leave the one before it live, so naming the
 * empty revision here would republish the document it was sent to withdraw.
 */
export const buildSpecDeletion = (coordinate: string): EventDraft => ({
  kind: DELETION_KIND,
  content: "",
  tags: [
    ["a", coordinate],
    ["k", String(SPEC_KIND)],
    ["client", CLIENT_NAME],
  ],
});

/**
 * A `d` derived from a title, which the schema allows in as many words. Only
 * ever a suggestion for a field that stays editable: an identifier somebody
 * typed is published verbatim, colons and capitals and all, and changing a `d`
 * publishes a second document rather than renaming the first.
 */
export const toIdentifier = (title: string, max = 64): string => {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Dropped rather than turned into a separator, so a possessive stays one
    // word: every document in the corpus titled with one is filed that way.
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastWord = cut.lastIndexOf("-");
  return (lastWord > 0 ? cut.slice(0, lastWord) : cut).replace(/-+$/, "");
};

/** Why a draft cannot be published. Codes, not sentences: the form writes the words. */
export type SpecFault =
  | "no-identifier"
  | "no-title"
  | "identifier-has-slash"
  | "identifier-too-long";

const MAX_IDENTIFIER = 256;

/**
 * An empty document is not a fault. `parseSpec` accepts a blank one on purpose,
 * and refusing it here would refuse a draft its author has not written yet.
 */
export const specFaults = (draft: SpecDraft): SpecFault[] => {
  const identifier = draft.identifier.trim();
  const faults: SpecFault[] = [];

  if (identifier === "") faults.push("no-identifier");
  // `specPath` only encodes the identifier, so a slash arrives as %2F in a path
  // segment, which proxies and servers are free to normalise or refuse.
  if (identifier.includes("/")) faults.push("identifier-has-slash");
  if (identifier.length > MAX_IDENTIFIER) faults.push("identifier-too-long");
  // The schema calls a title required, and this sends what the schema asks for
  // even though `parseSpec` above tolerates a document published without one.
  if (draft.title.trim() === "") faults.push("no-title");

  return faults;
};
