import { readFile } from "node:fs/promises";
import type { NostrEvent } from "@openspecs/nostr";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import type { ImportedEvent } from "./document.ts";
import { secretFor } from "./keys.ts";
import type { Corpus } from "./manifest.ts";
import { liveEvents, publishEvent, type RelayResult } from "./relays.ts";

export type Planned = {
  identifier: string;
  event: ImportedEvent;
  /** What the relays hold at this coordinate, and null where they hold nothing. */
  live: NostrEvent | null;
};

export type Plan = {
  corpus: Corpus;
  send: Planned[];
  unchanged: number;
};

const sameDocument = (draft: ImportedEvent, live: NostrEvent): boolean =>
  draft.content === live.content && JSON.stringify(draft.tags) === JSON.stringify(live.tags);

/**
 * A revision has to outrank the one it replaces, and a relay keeps the older of
 * two events sharing a timestamp. So a document whose commit is older than what
 * was published from it, which is any document changed in the manifest rather
 * than in git, is stamped one second past the revision it replaces.
 */
export const stampOf = (draft: ImportedEvent, live: NostrEvent | null): number =>
  live !== null && draft.created_at <= live.created_at ? live.created_at + 1 : draft.created_at;

export const planCorpus = (
  corpus: Corpus,
  drafts: ImportedEvent[],
  live: Map<string, NostrEvent>,
): Plan => {
  const send: Planned[] = [];
  let unchanged = 0;

  for (const event of drafts) {
    const identifier = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const held = live.get(identifier) ?? null;
    if (held !== null && sameDocument(event, held)) {
      unchanged++;
      continue;
    }
    send.push({ identifier, event, live: held });
  }

  return { corpus, send, unchanged };
};

export const readEvents = async (dir: string, corpus: Corpus): Promise<ImportedEvent[]> =>
  Promise.all(
    corpus.specs.map(async (spec) =>
      JSON.parse(await readFile(`${dir}/${corpus.name}/${spec.d}.json`, "utf8")),
    ),
  );

export type SendOptions = {
  relays: string[];
  secret: Uint8Array;
  pool?: SimplePool;
  onSent?: (identifier: string, results: RelayResult[]) => void;
};

export const sendPlan = async (
  plan: Plan,
  { relays, secret, pool, onSent }: SendOptions,
): Promise<Map<string, RelayResult[]>> => {
  const sent = new Map<string, RelayResult[]>();

  for (const planned of plan.send) {
    const signed = finalizeEvent(
      {
        kind: planned.event.kind,
        created_at: stampOf(planned.event, planned.live),
        tags: planned.event.tags,
        content: planned.event.content,
      },
      secret,
    );
    const results = await publishEvent(signed, relays, pool);
    sent.set(planned.identifier, results);
    onSent?.(planned.identifier, results);
  }

  return sent;
};

export type PublishOptions = {
  corpora: Corpus[];
  events: string;
  relays: string[];
  confirmed: boolean;
  env?: NodeJS.ProcessEnv;
  pool?: SimplePool;
};

/**
 * Reads what `build` wrote, signs it, and sends what the relays do not already
 * hold. A run that changes nothing sends nothing, which is what makes running
 * it twice safe and what a second run is for.
 *
 * Every key is resolved before the first event is sent. A corpus whose key is
 * missing must not be discovered halfway through publishing another one.
 */
export const publishEvents = async ({
  corpora,
  events,
  relays,
  confirmed,
  env,
  pool,
}: PublishOptions): Promise<void> => {
  // A plan needs no key, and asking for one to print what would be sent would
  // make the dry run the harder of the two things to do. Confirming resolves
  // every key before the first event goes out, so a corpus whose key is missing
  // is still not discovered halfway through publishing another one.
  const secrets = confirmed
    ? new Map(corpora.map((corpus) => [corpus.name, secretFor(corpus, env)]))
    : new Map<string, Uint8Array>();

  for (const corpus of corpora) {
    const drafts = await readEvents(events, corpus);
    const live = await liveEvents(
      corpus.pubkey,
      drafts.map((event) => event.tags.find((tag) => tag[0] === "d")?.[1] ?? ""),
      relays,
      pool,
    );
    const plan = planCorpus(corpus, drafts, live);
    const fresh = plan.send.filter((planned) => planned.live === null).length;

    console.log(
      `${corpus.name}\t${plan.send.length} to send (${fresh} new, ${plan.send.length - fresh} revised), ` +
        `${plan.unchanged} already published`,
    );

    if (!confirmed || plan.send.length === 0) continue;

    const secret = secrets.get(corpus.name);
    if (secret === undefined) throw new Error(`no key resolved for ${corpus.name}`);

    let refused = 0;
    await sendPlan(plan, {
      relays,
      secret,
      pool,
      onSent: (identifier, results) => {
        const failed = results.filter((result) => !result.accepted);
        if (failed.length === 0) return;
        refused++;
        for (const result of failed) {
          console.log(`\t${identifier}\t${result.relay}\t${result.message}`);
        }
      },
    });
    console.log(`\t${plan.send.length - refused} of ${plan.send.length} accepted everywhere`);
  }

  if (!confirmed) console.log("\nnothing was sent, pass --yes to publish this plan");
};
