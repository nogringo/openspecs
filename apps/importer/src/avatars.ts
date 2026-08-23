import { readFile } from "node:fs/promises";
import {
  authExpiry,
  type BlobDescriptor,
  BlossomError,
  buildUploadAuth,
  mirrorBlob,
  type NostrEvent,
  sha256Hex,
  uploadBlob,
} from "@openspecs/nostr";
import { finalizeEvent } from "nostr-tools/pure";
import { secretFor } from "./keys.ts";
import { type Blossom, type Corpus, type PictureField, writeBlossom } from "./manifest.ts";

/** What each key carries, and the file `build-avatars.ts` draws it into. */
const PICTURES = [
  { field: "picture", suffix: "" },
  { field: "banner", suffix: "-banner" },
] as const satisfies { field: PictureField; suffix: string }[];

export type AvatarOptions = {
  corpora: Corpus[];
  /** Where the drawn pictures are, named after the corpus they belong to. */
  dir: URL;
  servers: string[];
  confirmed: boolean;
  manifests?: URL;
  env?: NodeJS.ProcessEnv;
  now?: number;
};

const host = (server: string): string => {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
};

const said = (reason: unknown, server: string): string =>
  reason instanceof BlossomError
    ? `${host(reason.server)} ${reason.message}`
    : `${host(server)} did not work`;

type Replication = { blob: BlobDescriptor; stored: string[]; refused: string[] };

/**
 * One file onto every server, because a blob lives exactly as long as the
 * servers holding it: one copy is one outage or one full disk away from a
 * profile with a broken image in it.
 *
 * The first server to take it is asked to hand it to the rest rather than
 * sending the file again, and only a server that will not mirror is sent it.
 * One token covers all of it, which is what leaving the `server` tag off it buys.
 */
const replicate = async (
  servers: string[],
  file: Blob,
  auth: NostrEvent,
  sha256: string,
): Promise<Replication> => {
  const refused: string[] = [];
  const waiting: string[] = [];
  let taken: { blob: BlobDescriptor; server: string } | null = null;

  for (const server of servers) {
    if (taken !== null) {
      waiting.push(server);
      continue;
    }
    try {
      taken = { blob: await uploadBlob(server, file, auth, sha256), server };
    } catch (reason) {
      refused.push(said(reason, server));
    }
  }

  if (taken === null) throw new Error(`no server took it: ${refused.join(", ")}`);
  const first = taken;

  const copies = await Promise.all(
    waiting.map(async (server) => {
      try {
        await mirrorBlob(server, first.blob.url, auth);
        return server;
      } catch {
        // Mirroring is optional, and a server that will not do it may still
        // take the file the ordinary way.
        try {
          await uploadBlob(server, file, auth, sha256);
          return server;
        } catch (reason) {
          refused.push(said(reason, server));
          return null;
        }
      }
    }),
  );

  return {
    blob: first.blob,
    stored: [first.server, ...copies.filter((server): server is string => server !== null)],
    refused,
  };
};

/**
 * Sends each corpus its own pictures, signed by the key whose face they are, and
 * writes back what they hash to and where they are kept. The manifest is what
 * `publish:identity` reads afterwards, so the address a profile carries is a
 * line somebody reviewed rather than whatever a server answered mid-publish.
 *
 * One token per picture, since BUD-11 names the hash in the token: two pictures
 * are two hashes and so two signatures, however few servers they go to.
 */
export const uploadAvatars = async ({
  corpora,
  dir,
  servers,
  confirmed,
  manifests,
  env,
  now = Math.floor(Date.now() / 1000),
}: AvatarOptions): Promise<void> => {
  for (const corpus of corpora) {
    const hashes: Partial<Record<PictureField, string>> = {};
    /**
     * Narrowed by every picture that goes out, and starting from what the
     * manifest already claims: a server named here has to hold all of them, or
     * the address built from the first would resolve for one and not the other.
     */
    let kept: string[] | null = corpus.blossom?.servers ?? null;
    let sent = false;

    for (const { field, suffix } of PICTURES) {
      const bytes = new Uint8Array(await readFile(new URL(`${corpus.name}${suffix}.png`, dir)));
      const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer);
      hashes[field] = sha256;

      const label = `${corpus.name}\t${field}`;
      const settled =
        corpus.blossom?.[field] === sha256 &&
        servers.every((server) => corpus.blossom?.servers.includes(server));

      if (settled) {
        console.log(`${label}\tkept by ${corpus.blossom?.servers.length}\t${sha256}`);
        continue;
      }

      console.log(`${label}\tto send to ${servers.length}\t${sha256}`);
      if (!confirmed) continue;

      const auth = finalizeEvent(
        { ...buildUploadAuth(sha256, authExpiry()), created_at: now },
        secretFor(corpus, env),
      );

      const { blob, stored, refused } = await replicate(
        servers,
        new Blob([bytes], { type: "image/png" }),
        auth,
        sha256,
      );

      sent = true;
      kept = kept === null ? stored : kept.filter((server) => stored.includes(server));
      console.log(`\t${blob.url}`);
      console.log(`\tkept by ${stored.length} of ${servers.length}`);
      for (const message of refused) console.log(`\t\t${message}`);
    }

    if (!sent) continue;
    if (kept === null || kept.length === 0) {
      throw new Error(`no one server took every picture for ${corpus.name}`);
    }

    const picture = hashes.picture;
    if (picture === undefined) throw new Error(`${corpus.name} has no picture to record`);
    const blossom: Blossom = { servers: kept, picture, banner: hashes.banner };
    await writeBlossom(corpus.name, blossom, manifests);
  }

  if (!confirmed) console.log("\nnothing was sent, pass --yes to upload this");
};
