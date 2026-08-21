import type { ReactionTally } from "@openspecs/nostr";
import type { Response } from "~/lib/discussion";

/** A reaction is a symbol. What arrives is whatever a client put in `content`. */
const MAX_SYMBOL = 16;

const drawn = (symbol: string): string =>
  symbol.length <= MAX_SYMBOL ? symbol : `${symbol.slice(0, MAX_SYMBOL)}...`;

/** Grouped by thousands, in the mono face: sats are a number and read like one. */
const sats = (amount: number): string => amount.toLocaleString("en-US").replace(/,/g, " ");

const CHIP = "inline-flex items-center gap-1.5 rounded-sm border border-rule px-2 py-1";

const Chip = ({ tally }: { tally: ReactionTally }) => (
  <span className={CHIP} title={`${tally.count} from ${tally.symbol}`}>
    {tally.emojiUrl === null ? (
      <span className="normal-case tracking-normal">{drawn(tally.symbol)}</span>
    ) : (
      <img src={tally.emojiUrl} alt={tally.symbol} width={14} height={14} className="h-3.5 w-3.5" />
    )}
    <span className="text-muted">{tally.count}</span>
  </span>
);

/**
 * What a document or a comment was answered with, as a line of counts rather
 * than a row of bubbles: this is a record of review, and a tally is how a record
 * says how many.
 */
export const Tally = ({ response }: { response: Response }) => {
  if (response.reactions.length === 0 && response.zapSats === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      {response.reactions.map((tally) => (
        <Chip key={tally.symbol} tally={tally} />
      ))}
      {response.zapSats > 0 && (
        <span className={CHIP} title={`${sats(response.zapSats)} satoshis zapped`}>
          <span aria-hidden="true">⚡</span>
          <span className="text-muted">{sats(response.zapSats)}</span>
        </span>
      )}
    </div>
  );
};
