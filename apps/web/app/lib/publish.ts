import type { NostrEvent } from "@openspecs/nostr";
import { sessionState, signer } from "./session";
import { SessionMismatch } from "./signer";

export type RelayResult = { relay: string; accepted: boolean; message: string };

/** A relay that never answers must not leave the report unfinished. */
const TIMEOUT_MS = 8000;

const withTimeout = (work: Promise<string>): Promise<string> =>
  Promise.race([
    work,
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("no answer")), TIMEOUT_MS);
    }),
  ]);

const said = (value: unknown, fallback: string): string => {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.trim() === "" ? fallback : text.trim();
};

/**
 * A relay may refuse without saying why, and a blank line reads as a bug rather
 * than as a refusal, so every outcome gets words.
 */
export const toResult = (relay: string, settled: PromiseSettledResult<string>): RelayResult =>
  settled.status === "fulfilled"
    ? { relay, accepted: true, message: said(settled.value, "accepted") }
    : { relay, accepted: false, message: said(settled.reason, "refused") };

/**
 * Publishing is a write, and this project never writes from the server: the
 * event travels from the reader's browser straight to the relays.
 *
 * Results are handed over one by one, as each relay answers, rather than
 * collected at the end: relays answer in tens of milliseconds or in seconds, and
 * a reader should watch that happen instead of watching nothing. They are
 * returned as well, for a caller that only wants to know how many said yes.
 *
 * A pool of its own, destroyed when the last relay has answered: publishing is a
 * burst to a set of relays chosen for this one event, not a subscription anybody
 * keeps.
 */
export const publishTo = async (
  event: unknown,
  relays: string[],
  onResult?: (result: RelayResult) => void,
): Promise<RelayResult[]> => {
  if (relays.length === 0) return [];
  const { SimplePool } = await import("nostr-tools/pool");
  const pool = new SimplePool();
  const results: RelayResult[] = [];

  const record = (result: RelayResult) => {
    results.push(result);
    onResult?.(result);
  };

  try {
    await Promise.all(
      // biome-ignore lint/suspicious/noExplicitAny: the event is served as JSON and checked by each relay
      pool.publish(relays, event as any).map((publishing, index) =>
        withTimeout(publishing).then(
          (value) => record(toResult(relays[index] ?? "", { status: "fulfilled", value })),
          (reason) => record(toResult(relays[index] ?? "", { status: "rejected", reason })),
        ),
      ),
    );
  } finally {
    pool.destroy();
  }
  return results;
};

export type Draft = {
  kind: number;
  content: string;
  tags: string[][];
  /** Defaults to now. Here so a draft can be dated deliberately. */
  created_at?: number;
};

export type PublishReport = {
  event: NostrEvent;
  results: RelayResult[];
  accepted: number;
};

/**
 * Sign, then publish, and never the other way round. Somebody who cancels in
 * their extension must leave nothing on any relay, and a remote signer that
 * times out must not have half published anything.
 *
 * The relay set may be a promise, because resolving a NIP-65 list costs a round
 * trip and it should happen while its author is looking at their signer's prompt
 * rather than after they have dismissed it.
 *
 * A signature coming back under another key means the signer is signed in as
 * somebody else now. That is not something to publish and quietly attribute: it
 * throws, and the session is what has to be put right.
 */
export const signAndPublish = async (
  draft: Draft,
  relays: string[] | Promise<string[]>,
  onResult?: (result: RelayResult) => void,
): Promise<PublishReport> => {
  const signing = signer().then((ready) =>
    ready.signEvent({
      kind: draft.kind,
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
    }),
  );

  const [event, targets] = await Promise.all([signing, relays]);
  if (event.pubkey !== sessionState().pubkey) throw new SessionMismatch();

  const results = await publishTo(event, targets, onResult);
  return { event, results, accepted: results.filter((result) => result.accepted).length };
};
