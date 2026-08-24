import {
  editProfile,
  type NostrEvent,
  type ProfileDraft,
  pictureUrl,
  profileDraftOf,
  websiteUrl,
} from "@openspecs/nostr";
import { useId, useMemo, useState } from "react";
import { AuthorAvatar } from "~/components/author-avatar";
import { RelayReport } from "~/components/relay-results";
import { keyTextColor } from "~/lib/color";
import { shortNpub } from "~/lib/profile";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { identityRelays } from "~/lib/relays";
import { AddressCheck } from "./nip05-check";
import { PictureField } from "./picture-field";

type State = "editing" | "sending" | "sent" | "failed";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const LABEL = "block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted";

const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

const Row = ({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: (id: string) => React.ReactNode;
}) => {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {note !== undefined && <p className={NOTE}>{note}</p>}
    </div>
  );
};

/**
 * What the reader will look like to everybody else, drawn with the same avatar
 * and the same fallback every row on this site uses. It is above the fields
 * rather than beside them because it is the answer to what the fields are for.
 */
const Preview = ({
  pubkey,
  npub,
  draft,
}: {
  pubkey: string;
  npub: string;
  draft: ProfileDraft;
}) => (
  <div className="flex items-start gap-4 rounded-sm border border-dashed border-rule p-4">
    <AuthorAvatar pubkey={pubkey} picture={pictureUrl(draft.picture)} size={44} />
    <div className="min-w-0 space-y-1">
      <p style={{ color: keyTextColor(pubkey) }} className="truncate font-mono text-sm">
        {draft.name.trim() || shortNpub(npub)}
      </p>
      {draft.nip05?.trim() && (
        <p className="truncate font-mono text-[0.6875rem] text-muted">{draft.nip05}</p>
      )}
      {/* Drawn as the author's page will draw it, which is not as it was typed:
          a bare host is taken as https and the scheme is not shown back. */}
      {websiteUrl(draft.website) !== null && (
        <p className="truncate font-mono text-[0.6875rem] text-muted">
          {(websiteUrl(draft.website) ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </p>
      )}
      {draft.about?.trim() && (
        <p className="font-serif text-[0.8125rem] leading-snug text-muted">{draft.about}</p>
      )}
    </div>
  </div>
);

/**
 * A profile is one event and this writes the whole of it, so what is on screen
 * has to be what was published: the fields start filled from the live revision,
 * and `editProfile` hands back the fields nothing here draws untouched.
 *
 * The save is offered only once something has actually changed. Every save is a
 * new revision with a new date, and republishing a profile nobody edited spends
 * relay writes to say nothing.
 */
export const ProfileForm = ({
  me,
  npub,
  live,
  missing,
  onSaved,
}: {
  me: string;
  npub: string;
  live: NostrEvent | null;
  /** Nothing came back for this key, which is not the same as it having nothing. */
  missing: boolean;
  onSaved: (event: NostrEvent) => void;
}) => {
  const published = useMemo(() => profileDraftOf(live), [live]);
  const [draft, setDraft] = useState<ProfileDraft>(published);
  const [state, setState] = useState<State>("editing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof ProfileDraft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft({ ...draft, [field]: event.target.value });
    setState("editing");
  };

  const changed = JSON.stringify(draft) !== JSON.stringify(published);
  const picture = (draft.picture ?? "").trim();
  const unshowable = picture !== "" && pictureUrl(picture) === null;
  const website = (draft.website ?? "").trim();
  const unreachable = website !== "" && websiteUrl(website) === null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    setResults([]);
    setError(null);
    try {
      // Resolved while the signer asks, which is what `signAndPublish` takes a
      // promise for. The same relays it was read from, or a save would land
      // where the next read does not look.
      const targets = identityRelays(me);
      targets.then(setRelays).catch(() => {});

      const report = await signAndPublish(editProfile(live, draft), targets, (result) =>
        setResults((answered) => [...answered, result]),
      );

      if (report.accepted === 0) {
        setState("failed");
        setError("No relay took it. Nothing was published, and what was there is unchanged.");
        return;
      }

      // What went out rather than what was typed: a name with a space after it
      // is published without one, and a form still holding the space would offer
      // to save a second time to change nothing.
      setDraft(profileDraftOf(report.event));
      onSaved(report.event);
      setState("sent");
    } catch (reason) {
      setState("failed");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  return (
    <form className="space-y-6" onSubmit={save}>
      <Preview pubkey={me} npub={npub} draft={draft} />

      {missing && (
        <p className={WRONG}>
          Nothing came back for this key. Either it has published no profile yet, or no relay
          answered just now. Saving writes a new one over anything that was there.
        </p>
      )}

      <div className="space-y-4">
        <Row label="Name">
          {(id) => (
            <input
              id={id}
              className={FIELD}
              value={draft.name}
              onChange={set("name")}
              placeholder="The name you want to be called"
              autoComplete="nickname"
              spellCheck={false}
            />
          )}
        </Row>

        <Row label="About">
          {(id) => (
            <input
              id={id}
              className={FIELD}
              value={draft.about ?? ""}
              onChange={set("about")}
              placeholder="A sentence about yourself"
            />
          )}
        </Row>

        <Row label="Picture">
          {(id) => (
            <PictureField
              id={id}
              me={me}
              value={draft.picture ?? ""}
              onChange={(picture) => {
                setDraft({ ...draft, picture });
                setState("editing");
              }}
            />
          )}
        </Row>

        {unshowable && (
          <p className={WRONG}>
            Only an https address can be shown, so this picture would not appear anywhere. Your key
            mark is drawn in its place.
          </p>
        )}

        <Row label="Nostr address" note="A name at a domain that vouches for this key.">
          {(id) => (
            <input
              id={id}
              className={FIELD}
              value={draft.nip05 ?? ""}
              onChange={set("nip05")}
              placeholder="you@example.com"
              spellCheck={false}
            />
          )}
        </Row>

        <AddressCheck me={me} address={draft.nip05 ?? ""} />

        <Row label="Website" note="Somewhere else of yours, shown on your page here.">
          {(id) => (
            <input
              id={id}
              className={FIELD}
              value={draft.website ?? ""}
              onChange={set("website")}
              placeholder="example.com"
              inputMode="url"
              spellCheck={false}
            />
          )}
        </Row>

        {unreachable && (
          <p className={WRONG}>
            Only a web address can be linked to, so this one would be shown nowhere. Something like
            example.com, or the whole thing starting with https.
          </p>
        )}

        <Row label="Lightning address" note="Where a zap of yours is paid.">
          {(id) => (
            <input
              id={id}
              className={FIELD}
              value={draft.lud16 ?? ""}
              onChange={set("lud16")}
              placeholder="you@wallet.example"
              spellCheck={false}
            />
          )}
        </Row>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={ACTION} disabled={!changed || state === "sending"}>
          {state === "sending" ? "Saving" : "Save"}
        </button>
        {!changed && state !== "sent" && <p className={NOTE}>Nothing to save yet.</p>}
        {state === "sent" && !changed && <p className={NOTE}>Saved.</p>}
      </div>

      {(state === "sending" || state === "sent") && relays.length > 0 && (
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <RelayReport relays={relays} results={results} done={state === "sent"} />
        </div>
      )}

      {error !== null && <p className={WRONG}>{error}</p>}
    </form>
  );
};
