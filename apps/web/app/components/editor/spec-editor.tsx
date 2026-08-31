import {
  type EventDraft,
  editSpec,
  type ForkOrigin,
  fetchSpec,
  firstHeading,
  forkSpec,
  type NostrEvent,
  type SpecDraft,
  type SpecFault,
  specDraftOf,
  specFaults,
  specPath,
  tagValue,
  toCoordinate,
  toIdentifier,
  toNpub,
} from "@openspecs/nostr";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { RelayReport } from "~/components/relay-results";
import { rememberSpec } from "~/lib/corpus";
import { specEditPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { documentRelays } from "~/lib/relays";
import {
  clearDraft,
  type DraftSlot,
  readDraft,
  type StoredDraft,
  writeDraft,
} from "~/lib/spec-draft-store";
import {
  ACTION,
  DocumentField,
  IdentifierField,
  KindField,
  NOTE,
  Row,
  StatusField,
  SUGGESTION,
  SummaryField,
  TitleField,
  TopicField,
  WRONG,
} from "./fields";

type State = "editing" | "sending" | "sent" | "failed";

/** Long enough that a sentence is one write rather than forty. */
const SAVE_AFTER_MS = 800;

const SAYING: Record<SpecFault, string> = {
  "no-identifier": "A document needs an address to be found under.",
  "no-title": "A document needs a title. It is what every listing and link preview shows.",
  "identifier-has-slash":
    "An address cannot hold a slash: it is one part of a link, not a path through it.",
  "identifier-too-long": "That address is too long to be one.",
};

const ago = (savedAt: number): string => {
  const minutes = Math.round((Date.now() - savedAt) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hours ago` : "some days ago";
};

/**
 * Never sprung on anyone: the form always starts from the revision that was
 * published, and this only says that something else is available. Restoring is a
 * decision, the same way reading before writing is.
 */
const Held = ({
  held,
  live,
  onRestore,
  onDiscard,
}: {
  held: StoredDraft;
  live: NostrEvent | null;
  onRestore: () => void;
  onDiscard: () => void;
}) => (
  <div className="space-y-3 rounded-sm border border-dashed border-rule p-4">
    <p className={NOTE}>
      A draft of this document was saved in this browser {ago(held.savedAt)}, and it says something
      other than what is published.{" "}
      {live !== null && held.basedOn !== live.id && (
        <span className="text-signal-closed">
          It was started from a revision that is no longer the live one, so restoring it would write
          over whatever was published since.
        </span>
      )}
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={SUGGESTION} onClick={onRestore}>
        Restore it
      </button>
      <button type="button" className={SUGGESTION} onClick={onDiscard}>
        Discard it
      </button>
    </div>
  </div>
);

/**
 * Whose document this one is starting from, and nothing else. The form below is
 * already full of somebody else's writing, so the one thing it does not show is
 * whose. That a document signed by one key does not change another's needs no
 * saying, and the tag recording it is not the reader's business.
 */
const ForkedFrom = ({ origin }: { origin: NostrEvent }) => {
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  const npub = toNpub(origin.pubkey);
  const identifier = tagValue(origin, "d");

  useEffect(() => {
    wantAuthors([origin.pubkey]);
  }, [origin.pubkey]);

  return (
    <p className={NOTE}>
      Starting from{" "}
      <Link
        to={specPath({ pubkey: origin.pubkey, identifier })}
        className="underline decoration-rule underline-offset-2 hover:decoration-current"
      >
        {tagValue(origin, "title") || identifier}
      </Link>{" "}
      by {authorName(authors[origin.pubkey] ?? null, npub)}.
    </p>
  );
};

/**
 * A document replaces the whole of its previous revision, so what is on screen
 * has to be what was published: the fields start filled from the live event, and
 * `editSpec` hands back every tag nothing here draws untouched.
 *
 * Nothing is sent to this project's servers. The event is signed in this browser
 * and goes straight to relays, which is why there is no form action anywhere in
 * this app.
 */
export const SpecEditor = ({
  me,
  npub,
  live: initial,
  fork = null,
}: {
  me: string;
  npub: string;
  /** The revision being edited, or null for a document nobody has published. */
  live: NostrEvent | null;
  /** The document this one starts from, for a fork nobody has published yet. */
  fork?: { origin: NostrEvent; relay: string | null } | null;
}) => {
  const [live, setLive] = useState(initial);
  // Read off `live` and never off the prop: publishing the fork makes it a
  // document of its own, and every save after that is an ordinary revision.
  const forking = live === null && fork !== null;
  const origin = useMemo(
    (): ForkOrigin | null =>
      fork === null
        ? null
        : {
            pubkey: fork.origin.pubkey,
            // Read off the event rather than off the route, so the marker names
            // what was actually signed.
            identifier: tagValue(fork.origin, "d"),
            relay: fork.relay,
          },
    [fork],
  );
  const published = useMemo(
    () => (live === null && fork !== null ? specDraftOf(fork.origin) : specDraftOf(live)),
    [live, fork],
  );
  const [draft, setDraft] = useState<SpecDraft>(published);
  // Only until somebody types one of their own. A published address never moves,
  // and neither does a fork's, which keeps the name it was forked from until its
  // author decides otherwise.
  const [deriving, setDeriving] = useState(initial === null && fork === null);
  const [state, setState] = useState<State>("editing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [held, setHeld] = useState<StoredDraft | null>(null);

  const existing = live !== null;
  // The slot a draft is kept in, fixed for as long as this editor is open: a
  // first save turns a new document into an existing one, and the half written
  // draft it replaces is the one under the address it did not have yet.
  const slot = useMemo((): DraftSlot => {
    if (initial !== null) return { of: "doc", identifier: specDraftOf(initial).identifier };
    if (origin !== null) return { of: "fork", origin: toCoordinate(origin) };
    return { of: "new" };
  }, [initial, origin]);

  /**
   * The event this form would sign. A fork is built from the draft alone, never
   * from the document it came from: see `forkSpec`. Only the first one is, and
   * after it every revision is an ordinary edit that carries the marker through.
   */
  const build = (fields: SpecDraft): EventDraft =>
    origin !== null && !existing ? forkSpec(origin, me, fields) : editSpec(live, fields);

  /**
   * Whether saving would say anything different, asked of the event rather than
   * of the form. A blank kind row, a repeated topic and a trailing space all
   * change the draft and none of them changes the document.
   */
  const changed = JSON.stringify(build(draft)) !== JSON.stringify(build(published));

  const faults = specFaults(draft);
  const suggested = toIdentifier(draft.title);
  // What the document is already shown under when it carries no title tag.
  const heading = draft.title === "" ? firstHeading(draft.content) : null;
  const basedOn = live?.id ?? null;

  const latest = useRef({ draft, changed, basedOn });
  latest.current = { draft, changed, basedOn };

  useEffect(() => {
    const stored = readDraft(me, slot);
    setHeld(
      stored !== null && JSON.stringify(stored.draft) !== JSON.stringify(published) ? stored : null,
    );
  }, [me, slot, published]);

  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => {
      writeDraft(me, slot, { v: 1, draft, savedAt: Date.now(), basedOn });
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [changed, draft, basedOn, me, slot]);

  // A tab closed between two keystrokes would otherwise lose the sentence being
  // typed, which is the whole case this store exists for.
  useEffect(
    () => () => {
      const saved = latest.current;
      if (saved.changed) {
        writeDraft(me, slot, {
          v: 1,
          draft: saved.draft,
          savedAt: Date.now(),
          basedOn: saved.basedOn,
        });
      }
    },
    [me, slot],
  );

  const edit = (fields: Partial<SpecDraft>) => {
    setDraft((was) => ({ ...was, ...fields }));
    setState("editing");
    setTaken(null);
  };

  const setTitle = (title: string) =>
    edit(deriving ? { title, identifier: toIdentifier(title) } : { title });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    setResults([]);
    setError(null);
    setTaken(null);

    try {
      // Before the signer is asked rather than beside it: a prompt for an event
      // that is then refused is worse than the round trip that prevents it.
      if (!existing) {
        const identifier = draft.identifier.trim();
        if ((await fetchSpec({ pubkey: me, identifier })) !== null) {
          setState("failed");
          setTaken(identifier);
          return;
        }
      }

      const targets = documentRelays(me);
      targets.then(setRelays).catch(() => {});

      const report = await signAndPublish(build(draft), targets, (result) =>
        setResults((answered) => [...answered, result]),
      );

      if (report.accepted === 0) {
        setState("failed");
        setError("No relay took it. Nothing was published, and what was there is unchanged.");
        return;
      }

      // What went out rather than what was typed, and it is also what turns this
      // into an edit: the address locks itself and the next save is a revision.
      setLive(report.event);
      setDraft(specDraftOf(report.event));
      setDeriving(false);
      clearDraft(me, slot);
      setHeld(null);
      void rememberSpec(report.event);
      setState("sent");
    } catch (reason) {
      setState("failed");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  return (
    /*
     * The reading page's skeleton, turned around. There a contents rail sits
     * beside a measure of prose; here the same measure is what the prose is
     * typed into and the rail holds what is said about it. An editor that looks
     * nothing like the page it makes leaves its author guessing.
     */
    <form className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12" onSubmit={save}>
      <div className="max-w-[40rem] space-y-4">
        {forking && fork !== null && <ForkedFrom origin={fork.origin} />}

        {held !== null && (
          <Held
            held={held}
            live={live}
            onRestore={() => {
              setDraft(held.draft);
              setDeriving(false);
              setHeld(null);
              setState("editing");
            }}
            onDiscard={() => {
              clearDraft(me, slot);
              setHeld(null);
            }}
          />
        )}

        <TitleField value={draft.title} onChange={setTitle} />

        {/* Offered rather than filled in. A document published without a title
            is shown under its first heading, and quietly writing that back as a
            title would stop it following the heading. */}
        {heading !== null && (
          <button type="button" className={SUGGESTION} onClick={() => setTitle(heading)}>
            Use {heading}
          </button>
        )}

        {/* Under the title it is taken from, rather than a field of its own: it
            writes itself, and it is read far more often than it is answered. */}
        <IdentifierField
          value={draft.identifier}
          locked={existing}
          suggestion={
            !deriving && suggested !== "" && suggested !== draft.identifier ? suggested : null
          }
          onChange={(identifier) => {
            setDeriving(false);
            edit({ identifier });
          }}
        />

        {/* Where the published page puts it: under the title, above the
            document, at the measure the rest of the prose is read at. */}
        <div className="pt-2">
          <SummaryField value={draft.summary} onChange={(summary) => edit({ summary })} />
        </div>

        <div className="pt-4">
          <DocumentField
            content={draft.content}
            title={draft.title}
            onChange={(content) => edit({ content })}
          />
        </div>

        <div className="border-t border-rule pt-6">
          <KindField kinds={draft.kinds} onChange={(kinds) => edit({ kinds })} />
        </div>
      </div>

      {/* Sticky, so publishing is reachable from anywhere in a document that
          takes a morning to write. Below it on a phone, where a margin is a
          column nobody has room for.

          Scrolling one axis makes a box scroll on both, and a scroll box clips
          whatever leaves it, so a focus ring sitting two pixels outside a full
          width field was being cut down its sides. The negative margin buys
          those pixels back and the padding puts the fields where they were. */}
      <aside className="mt-16 space-y-8 border-t border-rule pt-8 lg:-mx-1.5 lg:mt-0 lg:self-start lg:border-t-0 lg:px-1.5 lg:pt-0 lg:sticky lg:top-10 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
        <div className="space-y-3">
          {/* A fork that changes nothing is still a real thing to publish: a copy
              under your own key, which is what a mirror is. Everywhere else an
              untouched form has nothing to send, and a blank one is refused by
              its faults rather than by this. */}
          <button
            type="submit"
            className={ACTION}
            disabled={(!changed && !forking) || faults.length > 0 || state === "sending"}
          >
            {state === "sending" ? "Publishing" : existing ? "Publish revision" : "Publish"}
          </button>

          {!changed && state !== "sent" && (
            <p className={NOTE}>
              {forking
                ? "Unchanged from the document you forked. Publishing it puts a copy of it under your key."
                : existing
                  ? "Nothing to save yet."
                  : "Nothing written yet."}
            </p>
          )}
          {state === "sent" && !changed && <p className={NOTE}>Published.</p>}

          {faults.length > 0 && changed && (
            <ul className="space-y-1">
              {faults.map((fault) => (
                <li key={fault} className={WRONG}>
                  {SAYING[fault]}
                </li>
              ))}
            </ul>
          )}

          {/* In the margin beside the document, which is the whole of what this
              site claims: the thing being written goes to relays, one square
              each, and nothing of it stays here. */}
          {(state === "sending" || state === "sent") && relays.length > 0 && (
            <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
              <RelayReport relays={relays} results={results} done={state === "sent"} />
            </div>
          )}

          {/* No warning about what that page will show. It was served from a
              cache holding the revision this one replaces, and it now says so
              itself and offers the new one, which is better than a sentence here
              asking somebody to wait a minute and see. */}
          {state === "sent" && live !== null && (
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
              <Link
                to={specPath({ pubkey: live.pubkey, identifier: draft.identifier })}
                className="underline decoration-rule underline-offset-2 hover:decoration-current"
              >
                Read the document
              </Link>
            </p>
          )}

          {taken !== null && (
            <p className={WRONG}>
              {forking
                ? "A fork keeps the name it was forked from, and this key already publishes a document under that name. "
                : "A document of yours is already published at that address. "}
              <Link to={specEditPath(npub, taken)} className="underline underline-offset-2">
                Edit that one
              </Link>
              , or choose another address.
            </p>
          )}

          {error !== null && <p className={WRONG}>{error}</p>}
        </div>

        <div className="space-y-6 border-t border-rule pt-6">
          {/* The examples belong in the note, not in the field: a placeholder
              reading "draft" in a field that can hold exactly that looks like a
              status already chosen. */}
          <Row label="Status" note="Where this document stands. Draft, active, deprecated.">
            {(id) => (
              <StatusField id={id} value={draft.status} onChange={(status) => edit({ status })} />
            )}
          </Row>

          <Row label="Topics" note="Readers browse by these.">
            {(id) => (
              <TopicField id={id} topics={draft.topics} onChange={(topics) => edit({ topics })} />
            )}
          </Row>
        </div>
      </aside>
    </form>
  );
};
