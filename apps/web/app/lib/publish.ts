import type { NostrEvent } from "@openspecs/nostr";
import { withClientTag } from "./client-tag";
import { sessionState, signer } from "./session";
import { SessionMismatch } from "./signer";

export type RelayResult = { relay: string; accepted: boolean; message: string };

/** A relay that never answers must not leave the report unfinished. */
const TIMEOUT_MS = 8000;

export const NO_ANSWER = "no answer";
export const NOT_REACHED = "not reached";

const withTimeout = (work: Promise<string>): Promise<string> =>
  Promise.race([
    work,
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error(NO_ANSWER)), TIMEOUT_MS);
    }),
  ]);

const said = (value: unknown, fallback: string): string => {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.trim() === "" ? fallback : text.trim();
};

/**
 * A relay that could not be reached at all does not reject. `SimplePool.publish`
 * catches the connection failure and resolves with this sentence in place of the
 * relay's answer, so a browser with no network would otherwise be told every
 * relay accepted what it never sent.
 */
const UNREACHABLE = "connection failure:";

/**
 * A relay may refuse without saying why, and a blank line reads as a bug rather
 * than as a refusal, so every outcome gets words.
 */
export const toResult = (relay: string, settled: PromiseSettledResult<string>): RelayResult => {
  if (settled.status === "rejected") {
    return { relay, accepted: false, message: said(settled.reason, "refused") };
  }
  const answer = said(settled.value, "accepted");
  return answer.startsWith(UNREACHABLE)
    ? { relay, accepted: false, message: NOT_REACHED }
    : { relay, accepted: true, message: answer };
};

/** A no worth asking again: the relay was not there, or asked for a pause. */
export const transient = (result: RelayResult): boolean =>
  !result.accepted &&
  (result.message === NOT_REACHED ||
    result.message === NO_ANSWER ||
    result.message.startsWith("rate-limited"));

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
 *
 * This is also where the app stops naming itself, when the reader has not asked
 * it to. Every draft that reaches a relay is signed here, and a tag has to go
 * before the signature covers it. `publishTo` is left alone on purpose: what it
 * is handed elsewhere is already signed.
 */
export const signDraft = async (draft: Draft): Promise<NostrEvent> => {
  const ready = await signer();
  const event = await ready.signEvent({
    kind: draft.kind,
    content: draft.content,
    tags: withClientTag(draft.tags),
    created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
  });
  if (event.pubkey !== sessionState().pubkey) throw new SessionMismatch();
  return event;
};

export const signAndPublish = async (
  draft: Draft,
  relays: string[] | Promise<string[]>,
  onResult?: (result: RelayResult) => void,
): Promise<PublishReport> => {
  const [event, targets] = await Promise.all([signDraft(draft), relays]);
  const results = await publishTo(event, targets, onResult);
  return { event, results, accepted: results.filter((result) => result.accepted).length };
};

/**
 * Signed by a key made for this one event and forgotten the moment it has
 * signed. What a reader sends when they would rather not be named: nothing
 * ties the event to them, and nothing ties it to anything else either, which
 * is what it is worth to a relay weighing who said it. The session is not
 * consulted, so this works for a reader who has no key at all. The client tag
 * follows the same setting as everything else this browser signs.
 */
export const publishAnonymously = async (
  draft: Draft,
  relays: string[] | Promise<string[]>,
  onResult?: (result: RelayResult) => void,
): Promise<PublishReport> => {
  const { finalizeEvent, generateSecretKey } = await import("nostr-tools/pure");
  const event = finalizeEvent(
    {
      kind: draft.kind,
      content: draft.content,
      tags: withClientTag(draft.tags),
      created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
    },
    generateSecretKey(),
  ) as NostrEvent;
  const results = await publishTo(event, await relays, onResult);
  return { event, results, accepted: results.filter((result) => result.accepted).length };
};
