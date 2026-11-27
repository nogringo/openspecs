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
import { enqueue } from "~/lib/outbox";
import { specEditPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { type RelayResult, signAndPublish, transient } from "~/lib/publish";
import { documentRelays } from "~/lib/relays";
import {
  clearDraft,
  type DraftSlot,
  readDraft,
  type StoredDraft,
  writeDraft,
} from "~/lib/spec-draft-store";
import { Changes } from "./changes";
import { DocumentField, Outline, useDocument } from "./document-field";
import { ago } from "./drafts";
import {
  ACTION,
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

type State = "editing" | "sending" | "sent" | "queued" | "failed";

/** Long enough that a sentence is one write rather than forty. */
const SAVE_AFTER_MS = 800;

/** Long enough that typing an address is one question to the relays, not a dozen. */
const ASK_AFTER_MS = 600;

const SAYING: Record<SpecFault, string> = {
  "no-identifier": "A document needs an address to be found under.",
  "no-title": "A document needs a title. It is what every listing and link preview shows.",
  "identifier-has-slash":
    "An address cannot hold a slash: it is one part of a link, not a path through it.",
  "identifier-too-long": "That address is too long to be one.",
};

/**
 * What the form opens on. A draft is picked up straight away when nothing was
 * published since it was started, which is always so for a document nobody has
 * published. One started from a revision that is no longer the live one is only
 * offered: restoring it would write over what came since, and that is a
 * decision. One saying what is already published has done its job.
 */
type Opening =
  | { as: "published" }
  | { as: "resumed"; stored: StoredDraft }
  | { as: "held"; stored: StoredDraft }
  | { as: "spent" };

const opening = (
  stored: StoredDraft | null,
  live: NostrEvent | null,
  says: (draft: SpecDraft) => boolean,
): Opening => {
  if (stored === null) return { as: "published" };
  if (says(stored.draft)) return { as: "spent" };
  if (live !== null && stored.basedOn !== live.id) return { as: "held", stored };
  return { as: "resumed", stored };
};

/**
 * A draft started from a revision that is no longer the live one. The form
 * starts from what is published, and this says something else is available.
 * Nothing typed is saved until it is answered, or the draft it offers would be
 * written over by the first sentence typed beside it.
 */
const Held = ({
  held,
  onRestore,
  onDiscard,
}: {
  held: StoredDraft;
  onRestore: () => void;
  onDiscard: () => void;
}) => (
  <div className="space-y-3 rounded-sm border border-dashed border-rule p-4">
    <p className={NOTE}>
      A draft of this document was saved in this browser {ago(held.savedAt)}, and it says something
      other than what is published.{" "}
      <span className="text-signal-closed">
        It was started from a revision that is no longer the live one, so restoring it would write
        over whatever was published since.
      </span>{" "}
      Until you choose, nothing typed here is kept.
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
  draftId = "",
}: {
  me: string;
  npub: string;
  /** The revision being edited, or null for a document nobody has published. */
  live: NostrEvent | null;
  /** The document this one starts from, for a fork nobody has published yet. */
  fork?: { origin: NostrEvent; relay: string | null } | null;
  /** Which of this key's new documents this is, for a document nobody has published. */
  draftId?: string;
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

  const existing = live !== null;
  // The slot a draft is kept in, fixed for as long as this editor is open: a
  // first save turns a new document into an existing one, and the half written
  // draft it replaces is the one under the address it did not have yet.
  const slot = useMemo((): DraftSlot => {
    if (initial !== null) return { of: "doc", identifier: specDraftOf(initial).identifier };
    if (origin !== null) return { of: "fork", origin: toCoordinate(origin) };
    return { of: "new", id: draftId };
  }, [initial, origin, draftId]);

  /**
   * The event this form would sign. A fork is built from the draft alone, never
   * from the document it came from: see `forkSpec`. Only the first one is, and
   * after it every revision is an ordinary edit that carries the marker through.
   */
  const build = (fields: SpecDraft): EventDraft =>
    origin !== null && !existing ? forkSpec(origin, me, fields) : editSpec(live, fields);

  /**
   * Compared as events rather than as forms. A blank kind row, a repeated topic
   * and a trailing space all change the draft and none of them changes the
   * document.
   */
  const signing = (fields: SpecDraft) => JSON.stringify(build(fields));

  /** Whether the address still follows the title: only until somebody types one of their own. */
  const follows = (fields: SpecDraft) =>
    live === null && fork === null && fields.identifier === toIdentifier(fields.title);

  const [opened] = useState(() =>
    opening(readDraft(me, slot), initial, (fields) => signing(fields) === signing(published)),
  );
  const start = opened.as === "resumed" ? opened.stored.draft : published;

  const [draft, setDraft] = useState<SpecDraft>(start);
  // A published address never moves, and neither does a fork's, which keeps the
  // name it was forked from until its author decides otherwise.
  const [deriving, setDeriving] = useState(() => follows(start));
  const [state, setState] = useState<State>("editing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  /**
   * The last address found to already hold a document of the reader's own, asked
   * of the relays as it is typed rather than when Publish is pressed. A fork
   * arrives wearing the name it came from, so the collision is its ordinary case
   * and not a slip, and an address is also the one field somebody changes to get
   * out of trouble, which is no help if the trouble only shows at the end.
   *
   * Never a refusal by itself. The relays may be unreachable, in which case this
   * stays quiet and the guard before the signer is what answers.
   */
  const [standing, setStanding] = useState<string | null>(null);
  /** One question per address, however many times the editor comes back to it. */
  const answered = useRef(new Map<string, boolean>());
  const [held, setHeld] = useState<StoredDraft | null>(opened.as === "held" ? opened.stored : null);
  const [resumed, setResumed] = useState<number | null>(
    opened.as === "resumed" ? opened.stored.savedAt : null,
  );
  /** What Start over took away, until the next keystroke makes it too late to want back. */
  const [dropped, setDropped] = useState<SpecDraft | null>(null);
  /** The event the changes were last shown for. */
  const [reviewed, setReviewed] = useState<string | null>(null);

  const doc = useDocument(draft.content, draft.title);

  const now = signing(draft);
  const changed = now !== signing(published);
  // The text a publish starts from, and so the one its changes are read against.
  const base = existing || forking ? published : null;
  const comparable = base !== null && changed;
  /**
   * A revision replaces the whole of the one before it, so it is shown before
   * it is signed. Once is enough: the button publishes once the changes on
   * screen are the ones it would send.
   */
  const reviewing = existing && changed && reviewed !== now;

  const faults = specFaults(draft);
  const wanted = draft.identifier.trim();
  /**
   * Known, not guessed: only an address the relays actually answered about. The
   * guard before the signer would refuse this publish anyway, so an enabled
   * button here promises a round trip that ends where the sentence beside the
   * address already says it ends.
   */
  const clashes = standing !== null && wanted === standing;
  const suggested = toIdentifier(draft.title);
  // What the document is already shown under when it carries no title tag.
  const heading = draft.title === "" ? firstHeading(draft.content) : null;
  const basedOn = live?.id ?? null;
  const keeping = changed && held === null;

  const latest = useRef({ draft, keeping, basedOn });
  latest.current = { draft, keeping, basedOn };

  useEffect(() => {
    if (opened.as === "spent") clearDraft(me, slot);
  }, [opened, me, slot]);

  useEffect(() => {
    if (doc.view === "changes") setReviewed(now);
  }, [doc.view, now]);

  useEffect(() => {
    // A published address never moves, so there is nothing to ask about.
    if (existing || wanted === "") return;

    const known = answered.current.get(wanted);
    if (known !== undefined) {
      setStanding(known ? wanted : null);
      return;
    }

    let live = true;
    const timer = setTimeout(() => {
      fetchSpec({ pubkey: me, identifier: wanted })
        .then((found) => {
          answered.current.set(wanted, found !== null);
          if (live) setStanding(found === null ? null : wanted);
        })
        .catch(() => {});
    }, ASK_AFTER_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [existing, me, wanted]);

  useEffect(() => {
    if (!keeping) return;
    const timer = setTimeout(() => {
      writeDraft(me, slot, { v: 1, draft, savedAt: Date.now(), basedOn });
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [keeping, draft, basedOn, me, slot]);

  // The sentence typed in the last moment before the page goes. Closing a tab
  // or reloading it unmounts nothing, so `pagehide` is what catches those, and a
  // phone that drops a tab in the background only ever said it was hidden.
  useEffect(() => {
    const flush = () => {
      const saved = latest.current;
      if (!saved.keeping) return;
      writeDraft(me, slot, {
        v: 1,
        draft: saved.draft,
        savedAt: Date.now(),
        basedOn: saved.basedOn,
      });
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, [me, slot]);

  const edit = (fields: Partial<SpecDraft>) => {
    setDraft((was) => ({ ...was, ...fields }));
    setState("editing");
    setTaken(null);
    setResumed(null);
    setDropped(null);
  };

  const setTitle = (title: string) =>
    edit(deriving ? { title, identifier: toIdentifier(title) } : { title });

  const startOver = () => {
    setDropped(draft);
    setDraft(published);
    setDeriving(follows(published));
    clearDraft(me, slot);
    setResumed(null);
    setState("editing");
    setTaken(null);
  };

  const undo = () => {
    if (dropped === null) return;
    setDraft(dropped);
    setDeriving(follows(dropped));
    setDropped(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reviewing) {
      doc.show("changes");
      return;
    }

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

      // A relay that was not there gets the signed event when it is back. Late
      // is safe: NIP-01 keeps the newest `created_at` of an address whatever
      // order its revisions arrive in.
      const owed = report.results.filter(transient).map((result) => result.relay);
      if (owed.length > 0) enqueue(report.event, owed);

      if (report.accepted === 0 && owed.length === 0) {
        setState("failed");
        setError("No relay took it. Nothing was published, and what was there is unchanged.");
        return;
      }

      // What went out rather than what was typed, and it is also what turns this
      // into an edit: the address locks itself and the next save is a revision.
      setLive(report.event);
      setDraft(specDraftOf(report.event));
      setDeriving(false);
      setHeld(null);
      setResumed(null);
      setDropped(null);

      // Still only in the outbox, which gives up after a day, so the draft
      // stays where it was until a relay has the event.
      if (report.accepted === 0) {
        setState("queued");
        return;
      }

      clearDraft(me, slot);
      void rememberSpec(report.event);
      setState("sent");
    } catch (reason) {
      setState("failed");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  const reported = state === "sending" || state === "sent" || state === "queued";

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

        {resumed !== null && <p className={NOTE}>Picked up where you left off, {ago(resumed)}.</p>}

        {held !== null && (
          <Held
            held={held}
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

        {clashes && (
          <p className={WRONG}>
            You already publish a document at that address.{" "}
            <Link to={specEditPath(npub, standing)} className="underline underline-offset-2">
              Edit that one
            </Link>
            , or change the address above.
          </p>
        )}

        {/* Where the published page puts it: under the title, above the
            document, at the measure the rest of the prose is read at. */}
        <div className="pt-2">
          <SummaryField value={draft.summary} onChange={(summary) => edit({ summary })} />
        </div>

        <div className="pt-4">
          <DocumentField
            doc={doc}
            content={draft.content}
            onChange={(content) => edit({ content })}
            comparable={comparable}
            changes={base !== null && <Changes base={base} draft={draft} />}
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
          <div className="flex flex-wrap items-center gap-2">
            {/* A fork that changes nothing is still a real thing to publish: a
                copy under your own key, which is what a mirror is. Everywhere
                else an untouched form has nothing to send, and a blank one is
                refused by its faults rather than by this. */}
            <button
              type="submit"
              className={ACTION}
              disabled={
                (!changed && !forking) || clashes || faults.length > 0 || state === "sending"
              }
            >
              {state === "sending"
                ? "Publishing"
                : reviewing
                  ? "Review changes"
                  : existing
                    ? "Publish revision"
                    : "Publish"}
            </button>

            {changed && state !== "sending" && (
              <button type="button" className={SUGGESTION} onClick={startOver}>
                Start over
              </button>
            )}
            {dropped !== null && (
              <button type="button" className={SUGGESTION} onClick={undo}>
                Undo
              </button>
            )}
          </div>

          {!changed && state !== "sent" && state !== "queued" && dropped === null && (
            <p className={NOTE}>
              {forking
                ? "Unchanged from the document you forked. Publishing it puts a copy of it under your key."
                : existing
                  ? "Nothing to save yet."
                  : "Nothing written yet."}
            </p>
          )}
          {state === "sent" && !changed && <p className={NOTE}>Published.</p>}
          {state === "queued" && !changed && (
            <p className={NOTE}>
              Signed, and waiting for a relay to answer. This browser keeps trying for a day,
              whenever this site is open in it.
            </p>
          )}

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
          {reported && relays.length > 0 && (
            <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
              <RelayReport relays={relays} results={results} done={state !== "sending"} />
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

        <Outline doc={doc} />
      </aside>
    </form>
  );
};
