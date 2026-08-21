import type { ZapTarget } from "@openspecs/nostr";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CopyButton } from "~/components/copy-button";
import { Qr } from "~/components/qr";
import { invoicePaid, subscribeDiscussionState } from "~/lib/discussion";
import type { Author } from "~/lib/profile";
import { connectWallet, forgetWallet, wallet, walletHost } from "~/lib/wallet";
import { canPayHere, PRESETS, payHere, quoteZap, type ZapQuote } from "~/lib/zap";

type Stage = "choosing" | "quoting" | "invoice" | "paying" | "paid";

const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-2 py-1.5 font-mono text-xs text-ink placeholder:text-muted";

const sats = (amount: number): string => amount.toLocaleString("en-US").replace(/,/g, " ");

/**
 * Where a reader connects a wallet, and where the one thing they need to know
 * about doing so is said: what they paste can spend, so it should be a
 * connection with a budget on it.
 */
const Wallet = () => {
  const [held, setHeld] = useState(() => wallet());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (held !== null) {
    return (
      <p className="flex flex-wrap items-center gap-2 font-serif text-[0.8125rem] text-muted">
        <span>Wallet on {walletHost(held)}.</span>
        <button
          type="button"
          className={CHROME}
          onClick={() => {
            forgetWallet();
            setHeld(null);
          }}
        >
          Forget wallet
        </button>
      </p>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const connected = connectWallet(input);
        if (connected === null) setError("That is not a wallet connection string.");
        else {
          setHeld(connected);
          setInput("");
        }
      }}
    >
      <input
        className={FIELD}
        type="password"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="nostr+walletconnect://..."
        autoComplete="off"
        spellCheck={false}
      />
      <p className="font-serif text-[0.8125rem] leading-snug text-muted">
        Kept on this device, and able to spend what it allows. Give it a budget in your wallet
        before you paste it here.
      </p>
      <button type="submit" className={CHROME} disabled={input.trim() === ""}>
        Connect wallet
      </button>
      {error !== null && <p className="font-serif text-[0.8125rem] text-signal-closed">{error}</p>}
    </form>
  );
};

export type ZapDialogProps = {
  me: string;
  author: Author;
  target: ZapTarget;
  /** What they are called, so the dialog says who is being paid. */
  name: string;
  onDone: () => void;
};

export const ZapDialog = ({ me, author, target, name, onDone }: ZapDialogProps) => {
  const [stage, setStage] = useState<Stage>("choosing");
  const [amount, setAmount] = useState(PRESETS[0] ?? 21);
  const [comment, setComment] = useState("");
  const [quote, setQuote] = useState<ZapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWallet, setShowWallet] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  /**
   * An invoice paid on a phone tells this page nothing. The receipt does: the
   * recipient's server publishes one naming the invoice it settles, and the
   * subscription this page already holds open is what brings it back. So a QR
   * scanned across the room closes the dialog it was scanned from.
   */
  const settled = useSyncExternalStore(
    subscribeDiscussionState,
    () => (quote === null ? false : invoicePaid(quote.invoice)),
    () => false,
  );

  useEffect(() => {
    if (!settled) return;
    setStage("paid");
    // Closed on its own, because the tally behind it has already gone up: the
    // page says the zap arrived, and this would only be saying it twice.
    const closing = setTimeout(onDone, 1500);
    return () => clearTimeout(closing);
  }, [settled, onDone]);

  const start = async () => {
    setStage("quoting");
    setError(null);
    try {
      const quoted = await quoteZap(me, author, target, amount, comment);
      setQuote(quoted);
      setStage("invoice");

      // Paid here when this device can, and offered as an invoice when it cannot.
      if (canPayHere()) {
        setStage("paying");
        abort.current = new AbortController();
        await payHere(quoted.invoice, abort.current.signal);
        setStage("paid");
      }
    } catch (reason) {
      setStage(quote === null ? "choosing" : "invoice");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  if (stage === "paid") {
    return (
      <div className="space-y-3">
        <p className="font-serif text-[0.9375rem] text-muted">
          Sent {sats(amount)} sats to {name}.
        </p>
        <button type="button" className={CHROME} onClick={onDone}>
          Close
        </button>
      </div>
    );
  }

  if (quote !== null && (stage === "invoice" || stage === "paying")) {
    return (
      <div className="space-y-3">
        <p className="font-serif text-[0.9375rem] text-muted">
          {sats(quote.sats)} sats to {name}.
        </p>
        <div className="flex justify-center">
          <Qr value={quote.invoice.toUpperCase()} size={200} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`lightning:${quote.invoice}`} className={CHROME}>
            Open wallet
          </a>
          <CopyButton value={quote.invoice} label="Copy invoice" />
        </div>
        {/* The receipt is published by their server, not by this page, so this
            says what it knows: the invoice was handed over. */}
        <p className="font-serif text-[0.8125rem] leading-snug text-muted">
          {stage === "paying"
            ? "Waiting for your wallet."
            : "The zap appears here once their server has published the receipt."}
        </p>
        {error !== null && (
          <p className="font-serif text-[0.8125rem] text-signal-closed">{error}</p>
        )}
        <button type="button" className={CHROME} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-serif text-[0.9375rem] text-muted">Zap {name}.</p>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(preset)}
            className={`rounded-sm border px-2 py-1 font-mono text-[0.6875rem] ${
              amount === preset
                ? "border-ink text-ink"
                : "border-rule text-muted hover:border-muted"
            }`}
          >
            {sats(preset)}
          </button>
        ))}
        <input
          className="w-24 rounded-sm border border-rule bg-paper px-2 py-1 font-mono text-[0.6875rem] text-ink"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(Math.max(1, Number(event.target.value) || 0))}
          aria-label="Amount in sats"
        />
      </div>

      <input
        className={FIELD}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="A word with it, if you like"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={CHROME} onClick={start} disabled={stage === "quoting"}>
          {stage === "quoting" ? "Asking their wallet" : `Zap ${sats(amount)}`}
        </button>
        <button type="button" className={CHROME} onClick={() => setShowWallet(!showWallet)}>
          {wallet() === null ? "Connect a wallet" : "Your wallet"}
        </button>
      </div>

      {showWallet && <Wallet />}
      {error !== null && (
        <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">{error}</p>
      )}
    </div>
  );
};
