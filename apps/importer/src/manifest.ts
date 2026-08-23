import { readdir, readFile, writeFile } from "node:fs/promises";
import { parsePubkey } from "@openspecs/nostr";
import { z } from "zod";

const kindSchema = z.object({
  kind: z.number().int().nonnegative(),
  name: z.string().min(1),
});

const specSchema = z.object({
  file: z.string().min(1),
  d: z.string().min(1),
  title: z.string().min(1),
  /** Null where the document claims none, rather than a status invented here. */
  status: z.string().min(1).nullable(),
  summary: z.string().min(1),
  kinds: z.array(kindSchema).default([]),
});

/**
 * The pictures this corpus keeps, as the two facts they actually are: what the
 * bytes hash to, and where they are kept. The address is neither, it is those
 * two multiplied out. BUD-01 has a server answer `GET /<sha256>` from the root
 * of its domain and accept an extension on it, so `<server>/<hash>.png` is an
 * address by specification rather than by convention, and writing it down would
 * be writing down a calculation.
 *
 * One list of servers, not one per picture: `upload:avatars` names only the
 * servers that took every one of them, so the first is known to hold whichever
 * is asked for, and BUD-03 gets a list of places that hold the lot.
 */
const blossomSchema = z.object({
  servers: z.array(z.url()).min(1),
  picture: z.string().regex(/^[0-9a-f]{64}$/),
  banner: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

const manifestSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  npub: z.string().startsWith("npub1"),
  blossom: blossomSchema.optional(),
  repo: z.url(),
  branch: z.string().min(1),
  license: z.string().min(1),
  topics: z.array(z.string().min(1)),
  specs: z.array(specSchema).min(1),
});

export type Blossom = z.infer<typeof blossomSchema>;
/** The two a key carries, named after the kind 0 fields they end up in. */
export type PictureField = "picture" | "banner";

/**
 * The address of one of them, multiplied back out. Null where the key has no
 * such picture, which is a kind 0 field left unwritten rather than left empty.
 */
export const pictureUrl = (blossom: Blossom | undefined, field: PictureField): string | null => {
  const hash = blossom?.[field];
  if (blossom === undefined || hash === undefined) return null;
  return `${blossom.servers[0]}/${hash}.png`;
};
export type SpecEntry = z.infer<typeof specSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** A manifest with its key resolved, which is what every naddr in the corpus is built on. */
export type Corpus = Manifest & { pubkey: string };

export const MANIFEST_DIR = new URL("../manifests/", import.meta.url);

const parseManifest = (name: string, raw: unknown): Corpus => {
  const manifest = manifestSchema.parse(raw);
  if (manifest.name !== name) {
    throw new Error(`${name}.json declares the name ${manifest.name}`);
  }

  const pubkey = parsePubkey(manifest.npub);
  if (pubkey === null) throw new Error(`${name}.json has an unreadable npub`);

  const seen = new Set<string>();
  for (const spec of manifest.specs) {
    for (const value of [spec.d, spec.file]) {
      if (seen.has(value)) throw new Error(`${name}.json lists ${value} twice`);
      seen.add(value);
    }
  }

  return { ...manifest, pubkey };
};

export const loadManifest = async (name: string, dir = MANIFEST_DIR): Promise<Corpus> => {
  const raw = await readFile(new URL(`${name}.json`, dir), "utf8");
  return parseManifest(name, JSON.parse(raw));
};

export const loadManifests = async (dir = MANIFEST_DIR): Promise<Corpus[]> => {
  const names = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();

  const corpora = await Promise.all(names.map((name) => loadManifest(name, dir)));

  const keys = new Map<string, string>();
  for (const corpus of corpora) {
    const owner = keys.get(corpus.pubkey);
    if (owner !== undefined) throw new Error(`${corpus.name} signs with the same key as ${owner}`);
    keys.set(corpus.pubkey, corpus.name);
  }

  return corpora;
};

const OPENS = '\n  "blossom": {\n';
const CLOSES = "\n  },\n";
/** The key the block is written in front of, since it describes the same key the npub names. */
const ANCHOR = '\n  "repo":';

const blossomBlock = (blossom: Blossom): string =>
  [
    '  "blossom": {',
    '    "servers": [',
    ...blossom.servers.map(
      (server, at) =>
        `      ${JSON.stringify(server)}${at < blossom.servers.length - 1 ? "," : ""}`,
    ),
    "    ],",
    `    "picture": ${JSON.stringify(blossom.picture)}${blossom.banner === undefined ? "" : ","}`,
    ...(blossom.banner === undefined ? [] : [`    "banner": ${JSON.stringify(blossom.banner)}`]),
    "  },",
  ].join("\n");

/**
 * Written into the file rather than over it. A manifest is two thousand lines
 * this repository's formatter owns, and rewriting one from its parsed object
 * would reflow every line of it to record a change on one.
 */
export const writeBlossom = async (
  name: string,
  blossom: Blossom,
  dir = MANIFEST_DIR,
): Promise<void> => {
  const path = new URL(`${name}.json`, dir);
  const raw = await readFile(path, "utf8");
  const block = `${blossomBlock(blossom)}\n`;

  const held = raw.indexOf(OPENS);
  if (held !== -1) {
    const ends = raw.indexOf(CLOSES, held + 1);
    if (ends === -1) throw new Error(`${name}.json has a blossom block this cannot read back`);
    await writeFile(path, raw.slice(0, held + 1) + block + raw.slice(ends + CLOSES.length));
    return;
  }

  const at = raw.indexOf(ANCHOR);
  if (at === -1) throw new Error(`${name}.json has no repo to write the pictures in front of`);
  await writeFile(path, raw.slice(0, at + 1) + block + raw.slice(at + 1));
};
