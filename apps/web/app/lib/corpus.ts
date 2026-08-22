import type { NostrEvent, Spec } from "@openspecs/nostr";
import { mergeDocs, readStored, writeStored } from "./corpus-store";
import type { SearchDoc } from "./search";

export type CorpusStatus = "idle" | "loading" | "syncing" | "ready" | "failed";

export type CorpusState = {
  docs: SearchDoc[];
  status: CorpusStatus;
  /** Documents read from the relays during this run, so a long walk can be watched. */
  read: number;
};

export const EMPTY_CORPUS: CorpusState = { docs: [], status: "idle", read: 0 };

/** Often enough to watch a walk progress, rarely enough not to re-rank on every page. */
const NOTIFY_MS = 150;

let state = EMPTY_CORPUS;
let docs: SearchDoc[] = [];
let read = 0;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

const publish = (status: CorpusStatus): void => {
  // A page waiting on the throttle would otherwise land after the walk ended and
  // put the corpus back to syncing, where nothing would ever move it again.
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  state = { docs, status, read };
  for (const listener of listeners) listener();
};

const publishSoon = (): void => {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    publish("syncing");
  }, NOTIFY_MS);
};

export const subscribeCorpus = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const corpusState = (): CorpusState => state;

/** The server holds no corpus: it renders the page, the browser searches it. */
export const serverCorpusState = (): CorpusState => EMPTY_CORPUS;

/**
 * This duplicates the listing card the server builds, plus the document itself.
 * The two cannot be shared: one is a server module, and the body is deliberately
 * left out of every loader payload.
 */
const toDoc = (
  spec: Spec,
  specPath: (spec: Spec) => string,
  toNpub: (pubkey: string) => string,
): SearchDoc => ({
  path: specPath(spec),
  title: spec.title,
  summary: spec.summary,
  pubkey: spec.pubkey,
  npub: toNpub(spec.pubkey),
  identifier: spec.identifier,
  status: spec.status,
  kinds: spec.kinds,
  topics: spec.topics,
  publishedAt: spec.publishedAt,
  revisedAt: spec.createdAt,
  content: spec.content,
});

const walk = async (): Promise<void> => {
  publish("loading");
  const stored = await readStored();
  docs = stored.docs;
  publish("syncing");

  try {
    // nostr-tools comes with the search, not with the page: someone who only
    // reads should not download a relay client to do it.
    const { specPath, syncSpecs, toNpub } = await import("@openspecs/nostr");
    const usable = (page: Spec[]): SearchDoc[] =>
      page.filter((spec) => !spec.isEmpty).map((spec) => toDoc(spec, specPath, toNpub));

    const { specs, cursors } = await syncSpecs({
      cursors: stored.cursors,
      onPage: (page) => {
        docs = mergeDocs(docs, usable(page));
        read += page.length;
        publishSoon();
      },
    });

    docs = mergeDocs(docs, usable(specs));
    publish("ready");
    // A relay that answered nothing keeps the cursor it had, rather than losing
    // its place because it was unreachable once.
    await writeStored(docs, { ...stored.cursors, ...cursors });
  } catch {
    // Whatever was read, from disk or from the relays before it broke, stays
    // searchable. The page says the corpus is partial rather than going blank.
    publish("failed");
  }
};

/** Idempotent: the corpus is read once per session, whoever asks for it. */
export const startCorpus = (): void => {
  if (started || typeof window === "undefined") return;
  started = true;
  void walk();
};

/**
 * A document its author just published. The walk above happens once a session
 * and nothing tells it a document appeared, so without this the one thing
 * somebody wrote here is the one thing they cannot find here.
 *
 * Written to disk as well as held, since a walk that has not started yet reads
 * from disk and would replace what is in memory with what is on it.
 */
export const rememberSpec = async (event: NostrEvent): Promise<void> => {
  const { parseSpec, specPath, toNpub } = await import("@openspecs/nostr");
  const spec = parseSpec(event);
  if (spec === null || spec.isEmpty) return;

  const doc = toDoc(spec, specPath, toNpub);
  docs = mergeDocs(docs, [doc]);
  if (started) publish(state.status);

  const stored = await readStored();
  await writeStored(mergeDocs(stored.docs, [doc]), stored.cursors);
};
