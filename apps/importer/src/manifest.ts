import { readdir, readFile } from "node:fs/promises";
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

const manifestSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  npub: z.string().startsWith("npub1"),
  repo: z.url(),
  branch: z.string().min(1),
  license: z.string().min(1),
  topics: z.array(z.string().min(1)),
  specs: z.array(specSchema).min(1),
});

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
