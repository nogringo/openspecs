import {
  buildReaction,
  buildRetraction,
  LIKE,
  type ReactionTally,
  type ReactionTarget,
} from "@openspecs/nostr";
import { useState } from "react";
import type { Response } from "~/lib/discussion";
import { addToDiscussion } from "~/lib/discussion";
import type { Author } from "~/lib/profile";
import { signAndPublish } from "~/lib/publish";
import { writeRelays } from "~/lib/relays";
import { canBeZapped } from "~/lib/zap";
import { ZapDialog } from "./zap-dialog";

/** A reaction is a symbol. What arrives is whatever a client put in `content`. */
const MAX_SYMBOL = 16;

/** What a palette offers. Anything else is typed, since content is a free string. */
const PALETTE = [LIKE, "🔥", "👍", "🤙", "😂", "🤔"];

const drawn = (symbol: string): string =>
  symbol.length <= MAX_SYMBOL ? symbol : `${symbol.slice(0, MAX_SYMBOL)}...`;

/** Grouped by thousands, in the mono face: sats are a number and read like one. */
const sats = (amount: number): string => amount.toLocaleString("en-US").replace(/,/g, " ");

const CHIP = "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1";

const Mark = ({ tally }: { tally: ReactionTally }) =>
  tally.emojiUrl === null ? (
    <span className="normal-case tracking-normal">{drawn(tally.symbol)}</span>
  ) : (
    <img src={tally.emojiUrl} alt={tally.symbol} width={14} height={14} className="h-3.5 w-3.5" />
  );

export type TallyProps = {
  response: Response;
  /** Null when nobody is signed in, which makes the row a report rather than a control. */
  me?: string | null;
  /** What a reaction would be about. Absent while the page is still loading. */
  target?: ReactionTarget | null;
  /** Who would be paid, and what they are called. Absent when nobody can be. */
  author?: Author | null;
  name?: string;
};

/**
 * What a document or a comment was answered with, as a line of counts rather
 * than a row of bubbles: this is a record of review, and a tally is how a record
 * says how many. Your own reaction is marked by the border rather than by a
 * colour, since the colours here mean a status a document has.
 */
export const Tally = ({
  response,
  me = null,
  target = null,
  author = null,
  name = "",
}: TallyProps) => {
  const [open, setOpen] = useState(false);
  const [zapping, setZapping] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const canReact = me !== null && target !== null;
  // Offered only to somebody who can be paid: a button that fails after three
  // clicks and a signature is worse than no button.
  const canZap = canReact && canBeZapped(author);

  const react = async (symbol: string) => {
    if (!canReact || busy) return;
    setBusy(true);
    setOpen(false);
    setTyped("");
    try {
      const mine = response.reactions.find((tally) => tally.symbol === symbol)?.by[me];
      // Reacting again to what you already said takes it back, which is the
      // only thing a second click could sensibly mean.
      const draft = mine === undefined ? buildReaction(target, symbol) : buildRetraction(mine);
      const relays = writeRelays(me, {
        addressed: [target.pubkey],
        hints: target.relay ? [target.relay] : [],
      });
      const report = await signAndPublish(draft, relays);
      if (report.accepted > 0) addToDiscussion(report.event);
    } catch {
      // Nothing said: the tally simply does not move, which is what a reader can
      // see for themselves. A reaction is not worth interrupting anybody over.
    } finally {
      setBusy(false);
    }
  };

  if (!canReact && response.reactions.length === 0 && response.zapSats === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      {response.reactions.map((tally) => {
        const mine = me !== null && tally.by[me] !== undefined;
        return (
          <button
            key={tally.symbol}
            type="button"
            disabled={!canReact || busy}
            onClick={() => react(tally.symbol)}
            title={mine ? "Take yours back" : `${tally.count} reacted with ${tally.symbol}`}
            className={`${CHIP} ${mine ? "border-ink text-ink" : "border-rule"} ${canReact ? "hover:border-muted" : "cursor-default"}`}
          >
            <Mark tally={tally} />
            <span className="text-muted">{tally.count}</span>
          </button>
        );
      })}

      {(response.zapSats > 0 || canZap) && (
        <span className="relative">
          <button
            type="button"
            disabled={!canZap}
            onClick={() => setZapping(!zapping)}
            title={canZap ? `Zap ${name || "them"}` : `${sats(response.zapSats)} satoshis zapped`}
            className={`${CHIP} border-rule ${canZap ? "hover:border-muted hover:text-ink" : "cursor-default"}`}
          >
            <span aria-hidden="true">⚡</span>
            {response.zapSats > 0 && <span className="text-muted">{sats(response.zapSats)}</span>}
          </button>

          {zapping && me !== null && author !== null && target !== null && (
            <span className="absolute left-0 top-full z-10 mt-1 block w-[min(20rem,calc(100vw-3rem))] rounded-sm border border-rule bg-paper p-3 normal-case tracking-normal shadow-sm">
              <ZapDialog
                me={me}
                author={author}
                name={name || "them"}
                target={{
                  pubkey: target.pubkey,
                  eventId: target.id,
                  coordinate: target.coordinate ?? null,
                  kind: target.kind,
                }}
                onDone={() => setZapping(false)}
              />
            </span>
          )}
        </span>
      )}

      {canReact && (
        <span className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(!open)}
            title="React"
            className={`${CHIP} border-rule text-muted hover:border-muted hover:text-ink`}
          >
            +
          </button>

          {open && (
            <span className="absolute left-0 top-full z-10 mt-1 flex w-56 flex-wrap items-center gap-1 rounded-sm border border-rule bg-paper p-2 normal-case tracking-normal shadow-sm">
              {PALETTE.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => react(symbol)}
                  className="rounded-sm px-1.5 py-1 text-sm hover:bg-shade"
                >
                  {symbol}
                </button>
              ))}
              {/* Content is a free string, so anything can be sent. */}
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && typed.trim() !== "") void react(typed.trim());
                }}
                placeholder="or type one"
                className="w-20 rounded-sm border border-rule bg-paper px-1.5 py-1 font-mono text-xs"
              />
            </span>
          )}
        </span>
      )}
    </div>
  );
};
