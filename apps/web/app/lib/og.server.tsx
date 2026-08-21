import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { loadAvatar } from "./avatar.server";
import { createLoadCache } from "./cache.server";
import { CARD_VERSION, OG_HEIGHT, OG_WIDTH, type OgAuthor, OgAuthorCard, OgCard } from "./og-card";
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

const draw = async (card: React.ReactElement): Promise<Uint8Array> => {
  const [loaded] = await ready();
  const svg = await satori(card, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loaded });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
};

const CACHE_DIR = process.env.OPENSPECS_CACHE_DIR ?? join(tmpdir(), "openspecs-og");

const DRAWN_MS = 24 * 60 * 60 * 1000;
/** A card whose picture would not load is redrawn soon, not kept for a day. */
const PARTIAL_MS = 5 * 60 * 1000;

/**
 * A card, and whether everything its author published made it onto the card.
 * Only a complete one is worth keeping, since the missing part is a host that
 * may answer on the next request.
 */
type Drawing = { card: React.ReactElement; complete: boolean };
type Drawn = { png: Uint8Array; complete: boolean };

/** Long lived: the file is named after the event, so a revision draws a new one. */
const memory = createLoadCache<Drawn>({
  max: 32,
  ttlMs: DRAWN_MS,
  ttlMsFor: (drawn) => (drawn.complete ? DRAWN_MS : PARTIAL_MS),
});

/**
 * Disk survives a restart, memory collapses the concurrent requests a freshly
 * unfurled link produces. A write that fails is not an error worth failing the
 * request over: the image was already drawn, and the next request redraws it.
 *
 * The name is what makes a card stale: it carries every revision the drawing
 * depends on, so nothing here is ever invalidated, only asked for under a name
 * nothing has drawn yet.
 */
const cardImage = async (name: string, drawing: () => Promise<Drawing>): Promise<Uint8Array> => {
  const drawn = await memory.get(`${CARD_VERSION}:${name}`, async () => {
    const file = join(CACHE_DIR, `v${CARD_VERSION}`, `${name}.png`);
    const cached = await readFile(file).catch(() => null);
    // Nothing incomplete is ever written, so a file on disk is a finished card
    // and the picture behind it never has to be fetched again.
    if (cached !== null) return { png: cached, complete: true };

    const { card, complete } = await drawing();
    const png = await draw(card);
    if (!complete) return { png, complete };

    // Renamed into place, so a half written file is never served to a crawler.
    const pending = `${file}.${process.pid}.tmp`;
    await mkdir(dirname(file), { recursive: true })
      .then(() => writeFile(pending, png))
      .then(() => rename(pending, file))
      .catch(() => {});
    return { png, complete };
  });

  return drawn.png;
};

/**
 * The profile's revision is part of the name: the card is cached for a week, and
 * an author who renamed themselves would otherwise keep the old one all of it.
 */
export const ogImage = (spec: SpecPage, author: Author | null): Promise<Uint8Array> =>
  cardImage(`${spec.eventId}-${author?.updatedAt ?? 0}`, async () => {
    const picture = await loadAvatar(author?.picture);
    return {
      card: <OgCard spec={spec} author={author} picture={picture.uri} />,
      complete: !picture.retry,
    };
  });

/**
 * An author's card counts their documents, so the count is part of its name too:
 * nothing else on the card changes when they publish, and the number would keep
 * a week of readers a document behind.
 */
export const authorOgImage = (
  author: Omit<OgAuthor, "picture">,
  profile: Author | null,
): Promise<Uint8Array> =>
  cardImage(`author-${author.pubkey}-${profile?.updatedAt ?? 0}-${author.count}`, async () => {
    const picture = await loadAvatar(profile?.picture);
    return {
      card: <OgAuthorCard author={{ ...author, picture: picture.uri }} />,
      complete: !picture.retry,
    };
  });
