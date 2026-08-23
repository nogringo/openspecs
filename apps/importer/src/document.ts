import { buildSpec, type EventDraft } from "@openspecs/nostr";
import { sourceUrl } from "./links.ts";
import type { Corpus, SpecEntry } from "./manifest.ts";

/** Not the web app: an event built here was never written by anyone using it. */
export const CLIENT = "openspecs-import";

export type ImportSource = {
  commit: string;
  /** Unix seconds of the commit that added the file, and the same on every revision. */
  publishedAt: number;
  /** Unix seconds of the commit this revision is. */
  createdAt: number;
  /** sha256 of the source bytes, before a single link was rewritten. */
  sha256: string;
};

/**
 * An event with the moment it stands for. `EventDraft` leaves `created_at` to
 * whoever publishes, which is right for something somebody just wrote and wrong
 * here: this revision happened when the commit did.
 */
export type ImportedEvent = EventDraft & { created_at: number };

/**
 * The document as an event, built from the manifest and the file, and from
 * nothing else. Same inputs, same bytes: that is what `verify` rests on, and
 * why no value here is read from the network or from a clock.
 *
 * The tags this adds to the schema's own are what make it a mirror rather than
 * a claim of authorship: `proxy` names the file it copies, and `x` is the hash
 * of that file's bytes, so anyone can fetch the source and check the copy.
 */
export const buildImport = (
  corpus: Corpus,
  entry: SpecEntry,
  content: string,
  source: ImportSource,
): ImportedEvent => {
  const draft = buildSpec({
    identifier: entry.d,
    title: entry.title,
    summary: entry.summary,
    content,
    status: entry.status ?? "",
    topics: corpus.topics,
    kinds: entry.kinds.map((entry) => ({ raw: String(entry.kind), name: entry.name })),
  });

  return {
    kind: draft.kind,
    content: draft.content,
    created_at: source.createdAt,
    tags: [
      ...draft.tags.map((tag) => (tag[0] === "client" ? ["client", CLIENT] : tag)),
      ["published_at", String(source.publishedAt)],
      ["proxy", sourceUrl(corpus.repo, source.commit, entry.file), "web"],
      ["x", source.sha256],
    ],
  };
};
