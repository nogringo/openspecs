import type { EventDraft, NostrEvent } from "@openspecs/nostr";
import {
  authorPath,
  BLOSSOM_SERVER_KIND,
  buildProfile,
  buildRelayList,
  buildServerList,
  PROFILE_KIND,
  RELAY_LIST_KIND,
} from "@openspecs/nostr";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { secretFor } from "./keys.ts";
import { type Corpus, pictureUrl } from "./manifest.ts";
import { liveReplaceable, publishEvent } from "./relays.ts";

/**
 * Where a reader sees what one of these keys published, written out like the
 * relay in `IMPORT_RELAYS`: nothing in a repository names the address this
 * project is deployed under, and a profile is no place to start configuring it.
 */
const SITE = "https://openspecs.uid.ovh";

/** Where a reader can thank whoever keeps these copies running. */
const LIGHTNING = "mongoose75@coinos.io";

/**
 * What a corpus says about itself, so that a reader landing on one of its
 * documents can tell a copy from the thing it copies.
 *
 * The name carries it too, not only the description: a name is what a client
 * puts beside a document, and one reading `Nostr Implementation Possibilities`
 * with nothing else would pass for the authors themselves.
 */
export const profileOf = (corpus: Corpus): EventDraft => {
  const profile = buildProfile({
    name: `${corpus.title} (mirror)`,
    picture: pictureUrl(corpus.blossom, "picture") ?? undefined,
    lud16: LIGHTNING,
    about: [
      `An unofficial mirror of ${corpus.repo}.`,
      "",
      "This key copied these documents, it did not write them. Each one names the file " +
        "and the commit it was copied from and carries the sha256 of those bytes, so any " +
        `copy can be checked against its source. The specifications are ${corpus.license}.`,
    ].join("\n"),
  });

  /**
   * The fields NIP-24 names that `ProfileDraft` deliberately has no opinion
   * about, added here rather than there: the site's own profile form draws
   * neither a banner nor a website and relies on `editProfile` handing back the
   * ones it did not write, so a package that owned them would clear them on
   * every save. These keys are the only thing in the project with an opinion.
   *
   * A banner nobody uploaded is left undefined, which is a key `JSON.stringify`
   * drops rather than writes empty.
   */
  return {
    ...profile,
    content: JSON.stringify({
      ...JSON.parse(profile.content),
      banner: pictureUrl(corpus.blossom, "banner") ?? undefined,
      website: `${SITE}${authorPath(corpus.pubkey)}`,
      bot: true,
    }),
  };
};

/**
 * Where this corpus is published, in the form every client already resolves.
 * This is what lets a document be found from its address alone: the site reads
 * a NIP-65 list before it goes looking, and so does anything else that follows
 * the outbox model, which is why the relay it names needs no hardcoding.
 */
export const relayListOf = (relays: string[]): EventDraft => buildRelayList(relays);

/**
 * BUD-03: where this key's picture is kept. A profile carries one address for
 * it, so a reader whose server has gone has a broken image and no way to know a
 * copy exists. This is what lets them take the hash out of the dead URL and
 * find one, which is what makes the copies worth making.
 */
export const serverListOf = (servers: string[]): EventDraft => buildServerList(servers);

export const identityOf = (corpus: Corpus, relays: string[]): EventDraft[] => {
  const servers = corpus.blossom?.servers ?? [];
  return [
    profileOf(corpus),
    relayListOf(relays),
    ...(servers.length === 0 ? [] : [serverListOf(servers)]),
  ];
};

export const IDENTITY_KINDS = [PROFILE_KIND, RELAY_LIST_KIND, BLOSSOM_SERVER_KIND];

export type IdentityOptions = {
  corpora: Corpus[];
  /** Where the corpus lives, which is what the relay list names. */
  relays: string[];
  /** Where the identity itself is published, indexers included. */
  targets: string[];
  confirmed: boolean;
  env?: NodeJS.ProcessEnv;
  pool?: SimplePool;
  now?: number;
};

const sameEvent = (draft: EventDraft, live: NostrEvent): boolean =>
  draft.content === live.content && JSON.stringify(draft.tags) === JSON.stringify(live.tags);

/**
 * Publishes what each corpus says about itself. Nothing here is derived from a
 * repository, so unlike a document these carry the moment they were signed,
 * stamped past whatever they replace so a relay keeps the newer.
 *
 * A relay list nobody can find is a relay list that does nothing, which is why
 * this is published to the indexers as well as to the corpus's own relay.
 */
export const publishIdentity = async ({
  corpora,
  relays,
  targets,
  confirmed,
  env,
  pool,
  now = Math.floor(Date.now() / 1000),
}: IdentityOptions): Promise<void> => {
  const secrets = confirmed
    ? new Map(corpora.map((corpus) => [corpus.name, secretFor(corpus, env)]))
    : new Map<string, Uint8Array>();

  const live = await liveReplaceable(
    corpora.map((corpus) => corpus.pubkey),
    IDENTITY_KINDS,
    targets,
    pool,
  );

  for (const corpus of corpora) {
    const drafts = identityOf(corpus, relays);
    const stale = drafts.filter((draft) => {
      const held = live.get(`${corpus.pubkey}:${draft.kind}`);
      return held === undefined || !sameEvent(draft, held);
    });

    console.log(
      `${corpus.name}\t${stale.length} of ${drafts.length} to send\t${corpus.npub.slice(0, 20)}...`,
    );
    if (!confirmed || stale.length === 0) continue;

    const secret = secrets.get(corpus.name);
    if (secret === undefined) throw new Error(`no key resolved for ${corpus.name}`);

    for (const draft of stale) {
      const held = live.get(`${corpus.pubkey}:${draft.kind}`);
      const signed = finalizeEvent(
        {
          kind: draft.kind,
          created_at: held !== undefined && held.created_at >= now ? held.created_at + 1 : now,
          tags: draft.tags,
          content: draft.content,
        },
        secret,
      );
      const results = await publishEvent(signed, targets, pool);
      const accepted = results.filter((result) => result.accepted).length;
      console.log(`\tkind ${draft.kind}\taccepted by ${accepted} of ${results.length}`);
      for (const refused of results.filter((result) => !result.accepted)) {
        console.log(`\t\t${refused.relay}\t${refused.message}`);
      }
    }
  }

  if (!confirmed) console.log("\nnothing was sent, pass --yes to publish this");
};
