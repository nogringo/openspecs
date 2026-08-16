import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { createLoadCache } from "./cache.server";
import { CARD_VERSION, OG_HEIGHT, OG_WIDTH, OgCard } from "./og-card";
import type { Author } from "./profile";
import type { SpecPage } from "./specs.server";

const require = createRequire(import.meta.url);

const FONT_FILES = [
  { weight: 400 as const, file: "jetbrains-mono-latin-400-normal.woff" },
  { weight: 500 as const, file: "jetbrains-mono-latin-500-normal.woff" },
];

/**
 * Loaded once per process, on the first image asked for rather than at boot: a
 * server that never draws a card should not pay for the font or the renderer.
 */
let fonts: Promise<Awaited<ReturnType<typeof loadFonts>>> | null = null;
let renderer: Promise<void> | null = null;

const loadFonts = () =>
  Promise.all(
    FONT_FILES.map(async ({ weight, file }) => ({
      name: "JetBrains Mono",
      weight,
      style: "normal" as const,
      data: await readFile(require.resolve(`@fontsource/jetbrains-mono/files/${file}`)),
    })),
  );

/**
 * The WebAssembly build of resvg rather than the native one: the runtime image is
 * Alpine on two architectures, and a portable binary is worth more here than the
 * milliseconds a native one would save on a cached image.
 */
const loadRenderer = () =>
  readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))
    .then((wasm) => initWasm(wasm))
    // The dev server re-evaluates this module while the WebAssembly one keeps
    // the state it already has, and initialising it twice throws.
    .catch((error: unknown) => {
      if (!String(error).includes("Already initialized")) throw error;
    });

const ready = () => {
  fonts ??= loadFonts();
  renderer ??= loadRenderer();
  return Promise.all([fonts, renderer]);
};

const draw = async (spec: SpecPage, author: Author | null): Promise<Uint8Array> => {
  const [loaded] = await ready();
  const svg = await satori(<OgCard spec={spec} author={author} />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: loaded,
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
};

const CACHE_DIR = process.env.OPENSPECS_CACHE_DIR ?? join(tmpdir(), "openspecs-og");

/** Long lived: the file is named after the event, so a revision draws a new one. */
const memory = createLoadCache<Uint8Array>({ max: 32, ttlMs: 24 * 60 * 60 * 1000 });

/**
 * Disk survives a restart, memory collapses the concurrent requests a freshly
 * unfurled link produces. A write that fails is not an error worth failing the
 * request over: the image was already drawn, and the next request redraws it.
 *
 * The profile's revision is part of the name: the card is cached for a week, and
 * an author who renamed themselves would otherwise keep the old one all of it.
 */
export const ogImage = (spec: SpecPage, author: Author | null): Promise<Uint8Array> =>
  memory.get(`${CARD_VERSION}:${spec.eventId}:${author?.updatedAt ?? 0}`, async () => {
    const file = join(
      CACHE_DIR,
      `v${CARD_VERSION}`,
      `${spec.eventId}-${author?.updatedAt ?? 0}.png`,
    );
    const cached = await readFile(file).catch(() => null);
    if (cached !== null) return cached;

    const png = await draw(spec, author);
    // Renamed into place, so a half written file is never served to a crawler.
    const pending = `${file}.${process.pid}.tmp`;
    await mkdir(dirname(file), { recursive: true })
      .then(() => writeFile(pending, png))
      .then(() => rename(pending, file))
      .catch(() => {});
    return png;
  });
