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
 * event travels from the reader's browser straight to the relays. It carries its
 * author's signature from the day it was written, which every relay checks
 * itself, so republishing asks for no key, no account and no session.
 *
 * Results are handed over one by one, as each relay answers, rather than
 * collected at the end: relays answer in tens of milliseconds or in seconds, and
 * a reader should watch that happen instead of watching nothing.
 *
 * nostr-tools is loaded on the click rather than with the page. It is coming to
 * the browser anyway, for the offline fallback and for signing, but someone who
 * only reads should not download a relay client to do it.
 */
export const rebroadcast = async (
  event: unknown,
  relays: string[],
  onResult: (result: RelayResult) => void,
): Promise<void> => {
  const { SimplePool } = await import("nostr-tools/pool");
  const pool = new SimplePool();

  try {
    await Promise.all(
      // biome-ignore lint/suspicious/noExplicitAny: the event is served as JSON and checked by each relay
      pool.publish(relays, event as any).map((publishing, index) =>
        withTimeout(publishing).then(
          (value) => onResult(toResult(relays[index] ?? "", { status: "fulfilled", value })),
          (reason) => onResult(toResult(relays[index] ?? "", { status: "rejected", reason })),
        ),
      ),
    );
  } finally {
    pool.destroy();
  }
};
