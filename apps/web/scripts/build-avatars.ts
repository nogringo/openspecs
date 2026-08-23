import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { decode } from "nostr-tools/nip19";
import type { ReactNode } from "react";
import satori from "satori";
import { keyTextHex } from "../app/lib/color.ts";

/**
 * Draws the avatar and the banner of every key this project signs with. Run it
 * after changing anything below: `node apps/web/scripts/build-avatars.ts`.
 *
 * One design, two jobs. The avatar is the stamp: the prefix its documents are
 * numbered by, over the three bars of `icon.svg`. The banner is the shelf behind
 * it, a corpus read at the distance a background is read from. A mirror is
 * coloured by its own key, the same rule the app follows wherever that key
 * appears. The archivist stays on paper: it has no reputation to carry, and its
 * key belongs to whoever runs the crawler.
 */
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SIZE = 512;

/** 3:1, which is the shape a profile screen crops a banner to. */
const BANNER_WIDTH = 1500;
const BANNER_HEIGHT = 500;

const INK = "#15171c";
const PAPER = "#fcfcfa";

/**
 * The bars are the word's own colour laid thin on the ink rather than a grey of
 * their own: an avatar that is one colour is one object, and the word still
 * leads. It is also what keeps the archivist under the same rule as the mirrors,
 * since paper laid this thin is the grey it would otherwise need as an exception.
 */
const BAR_OPACITY = 0.45;

/**
 * The ground bleeds to the edge and nothing else comes near it: a client crops an
 * avatar to a circle, and a corner is the first thing that crop takes away.
 */
const WORD_SIZE = 132;
const BAR_HEIGHT = 28;
const BAR_GAP = 14;
/** The 18/11/15 of `icon.svg`, scaled. */
const BAR_WIDTHS = [216, 132, 180];

const FONT_FILES = [
  { weight: 400 as const, file: "jetbrains-mono-latin-400-normal.woff" },
  { weight: 500 as const, file: "jetbrains-mono-latin-500-normal.woff" },
];

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
 * Quiet enough to sit behind the avatar and the name a client draws over it, and
 * no quieter: a background with nothing in it is a background nobody reads.
 */
const BANNER_PAD = 64;
const BANNER_TEXT = 19;
const BANNER_OPACITY = 0.45;

/** What fits on the page in two columns. A shorter corpus simply shows all of it. */
const BANNER_ENTRIES = 18;

/** The archivist's page, which has no words: three paragraphs closing on short lines. */
const BLANK_LINE = 18;
const BLANK_GAP = 14;
const BLANK_PARA_GAP = 36;
const BLANK_PARAGRAPHS = 3;
const BLANK_LINES = 3;
const BLANK_OPACITY = 0.22;

type Face = {
  name: string;
  word: string;
  color: string;
  /** What the line lengths are read off, byte by byte, as `keyMarkCells` reads its grid. */
  seed: string;
  /** The documents this key carries, which are what its banner is a page of. */
  entries: string[];
};

const card = ({ word, color }: Face) => ({
  type: "div",
  props: {
    style: {
      width: SIZE,
      height: SIZE,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: INK,
      fontFamily: "JetBrains Mono",
    },
    children: [
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            fontSize: WORD_SIZE,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: "0.06em",
            // The trailing letter-space would push a centred word off-centre.
            paddingLeft: WORD_SIZE * 0.06,
            color,
          },
          children: word,
        },
      },
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: BAR_GAP,
            marginTop: 36,
            opacity: BAR_OPACITY,
          },
          children: BAR_WIDTHS.map((width) => ({
            type: "div",
            props: { style: { width, height: BAR_HEIGHT, backgroundColor: color } },
          })),
        },
      },
    ],
  },
});

const byteAt = (hex: string, index: number): number =>
  Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) || 0;

/**
 * A line as long as the key says, and short where a paragraph ends. Nothing here
 * is chosen: two keys differ by their bytes, so their pages differ by their
 * ragged edges, which is the same trick the 5x5 mark plays at a smaller size.
 */
const lineWidth = (seed: string, index: number, closes: boolean): number => {
  const inner = BANNER_WIDTH - BANNER_PAD * 2;
  const byte = byteAt(seed, index);
  return closes ? inner * (0.2 + (byte % 45) / 100) : inner * (0.82 + (byte % 18) / 100);
};

const sheet = (children: object[]) => ({
  type: "div",
  props: {
    style: {
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
      display: "flex",
      alignItems: "center",
      padding: BANNER_PAD,
      backgroundColor: INK,
    },
    children,
  },
});

/** The corpus itself, read at the distance a background is read from. */
const index = ({ color, entries }: Face) => {
  const shown = entries.slice(0, BANNER_ENTRIES);
  const half = Math.ceil(shown.length / 2);
  return sheet([
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: BANNER_WIDTH - BANNER_PAD * 2,
          justifyContent: "space-between",
          fontFamily: "JetBrains Mono",
          fontSize: BANNER_TEXT,
          lineHeight: 1.75,
          color,
          opacity: BANNER_OPACITY,
        },
        children: [shown.slice(0, half), shown.slice(half)].map((column) => ({
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: column.map((title) => ({
              type: "div",
              // Never wrapped: a line running off the edge reads as a page that
              // carries on, and a line folded in half reads as a mistake.
              props: { style: { display: "flex", whiteSpace: "nowrap" }, children: title },
            })),
          },
        })),
      },
    },
  ]);
};

/**
 * The same page with no words on it, for a key whose documents this repository
 * cannot know: an archivist wraps whatever it is pointed at, and its shelf is
 * written after the picture is drawn.
 */
const blankPage = ({ color, seed }: Face) =>
  sheet([
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: BLANK_PARA_GAP,
          opacity: BLANK_OPACITY,
        },
        children: Array.from({ length: BLANK_PARAGRAPHS }, (_, paragraph) => ({
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: BLANK_GAP },
            children: Array.from({ length: BLANK_LINES }, (_, line) => ({
              type: "div",
              props: {
                style: {
                  width: lineWidth(seed, paragraph * BLANK_LINES + line, line === BLANK_LINES - 1),
                  height: BLANK_LINE,
                  backgroundColor: color,
                  flexShrink: 0,
                },
              },
            })),
          },
        })),
      },
    },
  ]);

const banner = (face: Face) => (face.entries.length > 0 ? index(face) : blankPage(face));

const pubkeyOf = (npub: string): string => {
  const decoded = decode(npub);
  if (decoded.type !== "npub") throw new Error(`not an npub: ${npub}`);
  return decoded.data;
};

/** Every document in a corpus is numbered by the same prefix, so read it there. */
const mirrors = async (): Promise<Face[]> => {
  const dir = join(here, "..", "..", "importer", "manifests");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  return Promise.all(
    files.sort().map(async (file) => {
      const manifest = JSON.parse(await readFile(join(dir, file), "utf8"));
      const pubkey = pubkeyOf(manifest.npub);
      return {
        name: manifest.name,
        word: manifest.specs[0].d.split("-")[0].toUpperCase(),
        color: keyTextHex(pubkey, "dark"),
        seed: pubkey,
        entries: manifest.specs.map((spec: { title: string }) => spec.title),
      };
    }),
  );
};

const faces: Face[] = [
  {
    name: "archivist",
    word: "1349",
    color: PAPER,
    // No key in this repository to read: every operator generates their own, so
    // every archivist gets the same page rather than one nobody could redraw.
    seed: createHash("sha256").update("archivist").digest("hex"),
    entries: [],
  },
  ...(await mirrors()),
];

const fonts = await loadFonts();
await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

const out = join(here, "..", "public", "avatars");
await mkdir(out, { recursive: true });

const draw = async (tree: object, name: string, width: number, height: number): Promise<void> => {
  // satori's JSX free form, so this file stays a script node can run as it is.
  const svg = await satori(tree as unknown as ReactNode, { width, height, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  await writeFile(join(out, `${name}.svg`), svg);
  await writeFile(join(out, `${name}.png`), png);
};

for (const face of faces) {
  await draw(card(face), face.name, SIZE, SIZE);
  await draw(banner(face), `${face.name}-banner`, BANNER_WIDTH, BANNER_HEIGHT);
  console.log(`${face.name}\t${face.word}\t${face.color}`);
}

console.log("avatars written to", out);
