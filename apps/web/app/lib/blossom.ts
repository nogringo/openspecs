import {
  authExpiry,
  type BlobDescriptor,
  BlossomError,
  buildServerList,
  buildUploadAuth,
  DEFAULT_BLOSSOM_SERVERS,
  fetchServerList,
  mirrorBlob,
  serverSet,
  sha256Hex,
  uploadBlob,
} from "@openspecs/nostr";
import { cleanPicture } from "./picture";
import { signAndPublish } from "./publish";
import { identityRelays } from "./relays";
import { signer } from "./session";

/**
 * What is read off the disk, before anything is done to it. Not what is sent:
 * the picture is redrawn and shrunk first, and what leaves is smaller than this
 * by a lot. This only stops a browser being asked to decode a photograph the
 * size of a film frame.
 */
export const MAX_PICTURE_BYTES = 16 * 1024 * 1024;

/**
 * A backstop, not a policy. How many servers hold a picture is the author's to
 * decide and more is better, so nothing here trims a list somebody meant. This
 * only stops a malformed one from opening fifty uploads, and it sits far above
 * any list anybody keeps.
 */
export const MAX_PICTURE_SERVERS = 16;

export type Upload = {
  blob: BlobDescriptor;
  /** Every server holding a copy now. The address in `blob` is one of them. */
  stored: string[];
  /** Named, asked, and would not take it, in words a reader can read. */
  refused: string[];
  /** Whether this key's server list had to be published to name the copies. */
  listed: "already" | "published" | "unheard";
  /** An animation that came out as its first frame, which re-encoding cannot keep. */
  stilled: boolean;
};

export type UploadStep = "cleaning" | "signing" | "sending" | "copying" | "naming";

export const isImage = (file: File): boolean => file.type.startsWith("image/");

const host = (server: string): string => new URL(server).host;

const said = (reason: unknown, server: string): string =>
  reason instanceof BlossomError
    ? `${host(reason.server)} ${reason.message}`
    : `${host(server)} did not work`;

/**
 * One picture onto every server the key names, because a blob lives exactly as
 * long as the servers holding it: one copy is one outage, one full disk or one
 * moderator away from a profile with a broken image in it.
 *
 * The first server to take the file is the one whose address goes in the
 * profile. The rest are asked to mirror it, which has them fetch it from that
 * one rather than from here, so the file crosses the reader's connection once
 * however many copies there end up being. A server that cannot mirror is sent
 * the file instead.
 *
 * Then the key's own server list, since without it the copies are unreachable:
 * a profile carries one URL, and BUD-03 is how a client with a dead one takes
 * the hash out of it and finds the rest. Replicating without publishing that is
 * paying for copies nobody can look up.
 *
 * One signature covers all of it, which is what leaving the `server` tag off the
 * token buys: four servers behind four prompts would be four chances to give up
 * halfway.
 */
export const uploadPicture = async (
  me: string,
  file: File,
  onStep?: (step: UploadStep) => void,
  /**
   * The address, the moment one server has it. Copying to the rest takes as long
   * as those servers take to fetch it from the first, and there is no reason to
   * hold a usable address back for that: the picture works from here on, and
   * what is still running only decides how long it goes on working.
   */
  onStored?: (blob: BlobDescriptor) => void,
): Promise<Upload> => {
  if (!isImage(file)) throw new Error("That is not an image.");
  if (file.size > MAX_PICTURE_BYTES) {
    throw new Error(
      `That is ${Math.round(file.size / 1024 / 1024)} MB, and ${MAX_PICTURE_BYTES / 1024 / 1024} MB is the most this sends.`,
    );
  }

  onStep?.("cleaning");
  // Resolved while the picture is being redrawn, the way every other write here
  // overlaps a lookup with the work in front of it.
  const relays = identityRelays(me);
  const listing = relays
    .then((targets) => fetchServerList(me, { indexers: targets }))
    .catch(() => [] as string[]);

  // Before the hash, and that is the whole point of the order: what is hashed is
  // what is sent, and what is sent has had everything but its pixels taken off.
  const cleaned = await cleanPicture(file);
  const sending = cleaned.file;
  const sha256 = await sha256Hex(await sending.arrayBuffer());

  onStep?.("signing");
  const ready = await signer();
  const auth = await ready.signEvent({
    ...buildUploadAuth(sha256, authExpiry()),
    created_at: Math.floor(Date.now() / 1000),
  });

  // An author's own servers, or the well-known ones, and never the two mixed.
  // Naming a server has to mean something, and a list of two that quietly became
  // those two plus four strangers is a choice taken away from whoever made it.
  const named = serverSet(await listing);
  const servers = (named.length > 0 ? named : serverSet(DEFAULT_BLOSSOM_SERVERS)).slice(
    0,
    MAX_PICTURE_SERVERS,
  );
  const refused: string[] = [];

  onStep?.("sending");
  let first: { blob: BlobDescriptor; server: string } | null = null;
  const waiting: string[] = [];
  for (const server of servers) {
    if (first !== null) {
      waiting.push(server);
      continue;
    }
    try {
      first = { blob: await uploadBlob(server, sending, auth, sha256), server };
    } catch (reason) {
      refused.push(said(reason, server));
    }
  }

  if (first === null) throw new Error(`No server took it. ${refused.join(". ")}.`);
  onStored?.(first.blob);

  onStep?.("copying");
  const copies = await Promise.all(
    waiting.map(async (server) => {
      try {
        await mirrorBlob(server, first.blob.url, auth);
        return server;
      } catch {
        // Mirroring is optional, and a server that will not do it may still take
        // the file the ordinary way.
        try {
          await uploadBlob(server, sending, auth, sha256);
          return server;
        } catch (reason) {
          refused.push(said(reason, server));
          return null;
        }
      }
    }),
  );

  const stored = [first.server, ...copies.filter((server): server is string => server !== null)];

  // Only when it would say something new. A list republished on every upload is
  // a new revision of the same four servers, and every client that caches it
  // pays for the round trip.
  const alreadyNamed = stored.every((server) => named.includes(server));
  let listed: Upload["listed"] = "already";
  if (!alreadyNamed) {
    onStep?.("naming");
    try {
      const report = await signAndPublish(buildServerList(serverSet(named, stored)), relays);
      listed = report.accepted > 0 ? "published" : "unheard";
    } catch {
      listed = "unheard";
    }
  }

  return { blob: first.blob, stored, refused, listed, stilled: cleaned.stilled };
};
