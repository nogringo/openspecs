import { buildReport, REPORT_TYPES, type ReportType } from "@openspecs/nostr";
import { useId, useState } from "react";
import { RelayReport } from "~/components/relay-results";
import { block, useBlocked } from "~/lib/blocked";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { reportRelays } from "~/lib/relays";
import type { MoreTarget } from "./more";
import { FIELD, NOTE, SUGGESTION, WRONG } from "./styles";

type Stage = "asking" | "sending" | "sent" | "failed";

/** NIP-56's words, said the way a reader would say them. */
const LABELS: Record<ReportType, string> = {
  spam: "Spam",
  illegal: "Illegal content",
  nudity: "Nudity or sexual content",
  profanity: "Hateful or abusive",
  malware: "Malware or a scam",
  impersonation: "Impersonation",
  other: "Something else",
};

const said = (reason: unknown): string =>
  reason instanceof Error && reason.message.trim() !== "" ? reason.message : "that did not work";

/**
 * One event, signed and sent wide. The two sentences before the form are the
 * whole of what a reader is agreeing to, and they are there because a report
 * feels like a private word to a moderator and is nothing of the kind.
 */
export const ReportForm = ({
  me,
  target,
  onClose,
}: {
  me: string;
  target: MoreTarget;
  onClose: () => void;
}) => {
  const group = useId();
  const blocked = useBlocked();
  const [type, setType] = useState<ReportType | null>(null);
  const [words, setWords] = useState("");
  const [stage, setStage] = useState<Stage>("asking");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const noun = target.kind;
  const accountBlocked = blocked.pubkeys.has(target.pubkey);

  const send = async () => {
    if (type === null) return;
    setStage("sending");
    setResults([]);
    setError(null);

    const targets = reportRelays(me, target.pubkey);
    targets.then(setRelays).catch(() => {});

    const reported =
      target.kind === "document"
        ? { pubkey: target.pubkey, id: target.id, coordinate: target.coordinate }
        : target.kind === "comment"
          ? { pubkey: target.pubkey, id: target.id }
          : { pubkey: target.pubkey };

    try {
      const report = await signAndPublish(buildReport(reported, type, words), targets, (result) =>
        setResults((answered) => [...answered, result]),
      );
      if (report.accepted === 0) {
        setStage("failed");
        setError("No relay accepted it. Nothing was published.");
        return;
      }
      setStage("sent");
    } catch (reason) {
      setStage("failed");
      setError(said(reason));
    }
  };

  if (stage === "asking") {
    return (
      <>
        <p className={NOTE}>
          A report is a signed public event. Anyone can read it, and it names you as the reporter.
        </p>
        <p className={NOTE}>
          It goes to every relay this page knows about, so the people who run them see it. This site
          hides nothing on the strength of a report; blocking is what does that, for you alone.
        </p>

        <fieldset className="space-y-1.5">
          <legend className="sr-only">What is wrong with this {noun}</legend>
          {REPORT_TYPES.map((option) => (
            <label key={option} className="flex items-center gap-2 font-mono text-xs text-ink">
              <input
                type="radio"
                name={group}
                value={option}
                checked={type === option}
                onChange={() => setType(option)}
              />
              {LABELS[option]}
            </label>
          ))}
        </fieldset>

        <textarea
          value={words}
          onChange={(event) => setWords(event.target.value)}
          rows={3}
          placeholder="Anything else the relays should know. Optional."
          aria-label="Anything else the relays should know"
          className={`${FIELD} font-serif text-[0.9375rem] leading-relaxed`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SUGGESTION} onClick={send} disabled={type === null}>
            Send report
          </button>
          <button type="button" className={SUGGESTION} onClick={onClose}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  const refused = results.filter((result) => !result.accepted).length;

  return (
    <>
      {error !== null && <p className={WRONG}>{error}</p>}
      {stage === "sent" && <p className={NOTE}>Sent.</p>}

      {relays.length > 0 && (
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <RelayReport relays={relays} results={results} done={stage !== "sending"} />
        </div>
      )}

      {stage === "sent" && refused > 0 && (
        <p className={NOTE}>
          Some relays refuse events from keys they do not know. A report only needs to land on a
          few.
        </p>
      )}

      {stage !== "sending" && (
        <div className="flex flex-wrap items-center gap-2">
          {stage === "sent" &&
            (accountBlocked ? (
              <span className={NOTE}>Blocked.</span>
            ) : (
              <button
                type="button"
                className={SUGGESTION}
                onClick={() => block({ type: "p", value: target.pubkey })}
              >
                Also block this account
              </button>
            ))}
          <button
            type="button"
            className={SUGGESTION}
            onClick={() => (stage === "failed" ? setStage("asking") : onClose())}
          >
            {stage === "failed" ? "Try again" : "Close"}
          </button>
        </div>
      )}
    </>
  );
};
