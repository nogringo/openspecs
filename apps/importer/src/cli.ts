import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeRelayPool, INDEXER_RELAYS, relaySet, relayUrl } from "@openspecs/nostr";
import { buildEvents } from "./build.ts";
import { publishIdentity } from "./identity.ts";
import { loadManifests, MANIFEST_DIR } from "./manifest.ts";
import { publishEvents } from "./publish.ts";

const args = process.argv.slice(2);

const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const flags = (name: string): string[] =>
  args.flatMap((value, at) => (value === `--${name}` ? [args[at + 1] ?? ""] : []));

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The keys, if this operator keeps them in a file rather than typing them. A
 * variable already set wins over the file, so one run can be pointed somewhere
 * else without editing anything, and a key never has to be typed at a prompt
 * that writes it to a history file.
 */
const loadEnv = (): void => {
  const path = here("../.env");
  if (existsSync(path)) process.loadEnvFile(path);
};

/**
 * No default: a relay to publish to is a decision, and one taken by leaving a
 * flag out is not one. Nothing here knows where the corpus belongs.
 */
const relaysFrom = (): string[] => {
  const named = [...flags("relay"), ...(process.env.OPENSPECS_IMPORT_RELAYS ?? "").split(",")];
  const relays = relaySet(named.map((url) => relayUrl(url) ?? "").filter((url) => url !== ""));
  if (relays.length === 0) {
    throw new Error("name a relay with --relay, or set OPENSPECS_IMPORT_RELAYS");
  }
  return relays;
};

const main = async (): Promise<void> => {
  loadEnv();
  const command = args[0];
  const manifests = flag("manifests", "");
  const corpora = await loadManifests(
    manifests === "" ? MANIFEST_DIR : pathToFileURL(`${manifests}/`),
  );

  if (command === "build") {
    await buildEvents({
      corpora,
      cache: flag("cache", here("../.cache")),
      out: flag("out", here("../events")),
    });
    return;
  }

  if (command === "publish") {
    try {
      await publishEvents({
        corpora,
        events: flag("events", here("../events")),
        relays: relaysFrom(),
        confirmed: args.includes("--yes"),
      });
    } finally {
      closeRelayPool();
    }
    return;
  }

  if (command === "identity") {
    try {
      const relays = relaysFrom();
      await publishIdentity({
        corpora,
        relays,
        // The indexers as well: a relay list nobody can find resolves nothing,
        // and finding one is what every outbox lookup starts with.
        targets: relaySet(relays, INDEXER_RELAYS),
        confirmed: args.includes("--yes"),
      });
    } finally {
      closeRelayPool();
    }
    return;
  }

  throw new Error("usage: build | publish | identity");
};

await main();
