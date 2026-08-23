import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BLOSSOM_AUTH_KIND, blobHash, sha256Hex, toNpub } from "@openspecs/nostr";
import { nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadAvatars } from "../src/avatars.ts";
import { keyVariable } from "../src/keys.ts";
import { loadManifest, pictureUrl } from "../src/manifest.ts";

const secret = generateSecretKey();
const npub = toNpub(getPublicKey(secret));
const env = { [keyVariable("buds")]: nsecEncode(secret) };

const SERVERS = ["https://one.example", "https://two.example"];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const BANNER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);

const manifest = `{
  "name": "buds",
  "title": "Blossom Upgrade Documents",
  "npub": "${npub}",
  "repo": "https://github.com/hzrd149/blossom",
  "branch": "master",
  "license": "Unlicense",
  "topics": ["blossom", "bud"],
  "specs": [
    {
      "file": "buds/BUD-01.md",
      "d": "bud-01",
      "title": "Server requirements and blob retrieval",
      "status": "draft",
      "summary": "What a server has to answer, and how a blob is asked for."
    }
  ]
}
`;

type Call = { path: string; authorization: string };

let dir: string;
let calls: Call[];

const at = () => pathToFileURL(`${dir}/`);
const held = () => loadManifest("buds", at());

/** Read back before every run, since rewriting that file is what this command does. */
const run = async (confirmed: boolean) =>
  uploadAvatars({
    corpora: [await held()],
    dir: at(),
    manifests: at(),
    servers: SERVERS,
    confirmed,
    env,
  });

/**
 * Answers the way a server does, echoing the hash the client said it was
 * sending rather than one the test decided, so a redrawn picture is a different
 * address here too.
 */
const serve = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  calls.push({ path: url.pathname, authorization: headers.get("Authorization") ?? "" });

  const sha256 =
    headers.get("X-SHA-256") ??
    blobHash(String(JSON.parse(String(init?.body ?? "{}")).url ?? "")) ??
    "";
  return Response.json({
    url: `${url.origin}/${sha256}.png`,
    sha256,
    size: 0,
    type: "image/png",
    uploaded: 1,
  });
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openspecs-avatars-"));
  await writeFile(join(dir, "buds.json"), manifest);
  await writeFile(join(dir, "buds.png"), PNG);
  await writeFile(join(dir, "buds-banner.png"), BANNER);
  calls = [];
  globalThis.fetch = vi.fn(serve) as typeof fetch;
});

describe("uploadAvatars", () => {
  it("sends nothing until it is told to", async () => {
    await run(false);
    expect(calls).toHaveLength(0);
    expect((await held()).blossom).toBeUndefined();
  });

  it("writes back what the bytes hash to, and the servers that took every one", async () => {
    await run(true);
    const { blossom } = await held();
    expect(blossom?.picture).toBe(await sha256Hex(PNG.buffer as ArrayBuffer));
    expect(blossom?.banner).toBe(await sha256Hex(BANNER.buffer as ArrayBuffer));
    expect(blossom?.servers).toEqual(SERVERS);
  });

  it("writes the address nowhere, since a server and a hash already spell it", async () => {
    await run(true);
    const raw = await readFile(join(dir, "buds.json"), "utf8");
    expect(raw).not.toContain(".png");
    expect(pictureUrl((await held()).blossom, "picture")).toBe(
      `${SERVERS[0]}/${await sha256Hex(PNG.buffer as ArrayBuffer)}.png`,
    );
  });

  it("sends the banner under its own hash, since a token names the bytes it covers", async () => {
    await run(true);
    const hashes = calls
      .filter((call) => call.path === "/upload")
      .map((call) => {
        const token = call.authorization.replace(/^Nostr /, "");
        return JSON.parse(Buffer.from(token, "base64url").toString("utf8")).tags.find(
          (tag: string[]) => tag[0] === "x",
        )?.[1];
      });
    expect(hashes).toEqual([
      await sha256Hex(PNG.buffer as ArrayBuffer),
      await sha256Hex(BANNER.buffer as ArrayBuffer),
    ]);
  });

  it("authorises the upload with a token signed by the key the manifest names", async () => {
    await run(true);
    const token = (calls[0]?.authorization ?? "").replace(/^Nostr /, "");
    const auth = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    expect(auth.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(auth.pubkey).toBe(getPublicKey(secret));
    expect(auth.tags).toContainEqual(["t", "upload"]);
    expect(auth.tags).toContainEqual(["x", await sha256Hex(PNG.buffer as ArrayBuffer)]);
  });

  it("asks the second server to copy it rather than sending the file again", async () => {
    await run(true);
    expect(calls.map((call) => call.path)).toEqual(["/upload", "/mirror", "/upload", "/mirror"]);
  });

  it("sends nothing a second time, since the address already names these bytes", async () => {
    await run(true);
    const sent = calls.length;
    await run(true);
    expect(calls).toHaveLength(sent);
  });

  it("sends only what was redrawn, and leaves the other where it is", async () => {
    await run(true);
    const before = await held();
    calls = [];

    await writeFile(join(dir, "buds.png"), new Uint8Array([1, 2, 3]));
    await run(true);

    expect(calls.map((call) => call.path)).toEqual(["/upload", "/mirror"]);
    const after = await held();
    expect(after.blossom?.picture).not.toBe(before.blossom?.picture);
    expect(after.blossom?.banner).toBe(before.blossom?.banner);
  });

  it("leaves the rest of the manifest where it was", async () => {
    await run(true);
    const raw = await readFile(join(dir, "buds.json"), "utf8");
    expect(raw).toContain('"topics": ["blossom", "bud"],');
    expect(JSON.parse(raw).specs).toHaveLength(1);
  });

  it("keeps the two in the order the schema declares them", async () => {
    await run(true);
    const raw = await readFile(join(dir, "buds.json"), "utf8");
    expect(raw.indexOf('"picture"')).toBeLessThan(raw.indexOf('"banner"'));
    expect(raw.indexOf('"banner"')).toBeLessThan(raw.indexOf('"repo"'));
  });

  it("names only the servers that took every picture", async () => {
    // The second server takes the avatar and refuses the banner, so it holds
    // one of the two and is named for neither.
    let uploads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname !== "/" && url.origin === SERVERS[1]) {
        uploads += 1;
        if (uploads > 1) return new Response("no", { status: 403 });
      }
      return serve(input, init);
    }) as typeof fetch;

    await run(true);
    expect((await held()).blossom?.servers).toEqual([SERVERS[0]]);
  });
});
