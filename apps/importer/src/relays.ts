import { type NostrEvent, queryRelays, relayPool, SPEC_KIND } from "@openspecs/nostr";
import type { SimplePool } from "nostr-tools/pool";

export type RelayResult = { relay: string; accepted: boolean; message: string };

const TIMEOUT_MS = 10_000;

/** How many identifiers one filter carries: a relay that refuses a huge one would read as empty. */
const PER_QUERY = 50;

/**
 * `SimplePool.publish` resolves rather than rejects when it never reached the
 * relay at all, so an unreachable relay would otherwise be counted as one that
 * accepted what was never sent.
 */
const UNREACHABLE = "connection failure:";

const said = (value: unknown, fallback: string): string => {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.trim() === "" ? fallback : text.trim();
};

const answered = (relay: string, settled: PromiseSettledResult<string>): RelayResult => {
  if (settled.status === "rejected") {
    return { relay, accepted: false, message: said(settled.reason, "refused") };
  }
  const answer = said(settled.value, "accepted");
  return answer.startsWith(UNREACHABLE)
    ? { relay, accepted: false, message: "not reached" }
    : { relay, accepted: true, message: answer };
};

const timed = (work: Promise<string>): Promise<string> =>
  Promise.race([
    work,
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("no answer")), TIMEOUT_MS).unref();
    }),
  ]);

export const publishEvent = async (
  event: NostrEvent,
  relays: string[],
  pool: SimplePool = relayPool(),
): Promise<RelayResult[]> => {
  const settled = await Promise.allSettled(
    pool.publish(relays, event).map((answer) => timed(answer)),
  );
  return settled.map((result, index) => answered(relays[index] ?? "", result));
};

/**
 * The revision each coordinate holds now, so a run can tell what it would
 * change from what it would repeat.
 *
 * Relays keep serving revisions they have already replaced, so the newest of
 * what comes back wins, and a tie goes to the lowest id as NIP-01 asks.
 */
export const liveEvents = async (
  pubkey: string,
  identifiers: string[],
  relays: string[],
  pool?: SimplePool,
): Promise<Map<string, NostrEvent>> => {
  const live = new Map<string, NostrEvent>();
  if (relays.length === 0) return live;

  for (let at = 0; at < identifiers.length; at += PER_QUERY) {
    const events = await queryRelays(
      relays,
      {
        kinds: [SPEC_KIND],
        authors: [pubkey],
        "#d": identifiers.slice(at, at + PER_QUERY),
      },
      { pool, timeoutMs: TIMEOUT_MS },
    );

    for (const event of events) {
      const identifier = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
      const held = live.get(identifier);
      const newer =
        held === undefined ||
        event.created_at > held.created_at ||
        (event.created_at === held.created_at && event.id < held.id);
      if (newer) live.set(identifier, event);
    }
  }

  return live;
};
