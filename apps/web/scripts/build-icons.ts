import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/**
 * Draws the raster icons from `public/icon.svg`, the one source of the mark.
 * Run it after changing that file: `node apps/web/scripts/build-icons.ts`.
 */
const require = createRequire(import.meta.url);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

const svg = await readFile(join(publicDir, "icon.svg"));
const render = (size: number): Uint8Array =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

/** An ICO is a small header, one entry per size, and the PNGs appended whole. */
const ico = (images: { size: number; png: Uint8Array }[]): Uint8Array => {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.byteLength, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.byteLength;
  });

  return Buffer.concat([header, ...images.map((image) => Buffer.from(image.png))]);
};

await writeFile(
  join(publicDir, "favicon.ico"),
  ico([16, 32, 48].map((size) => ({ size, png: render(size) }))),
);
await writeFile(join(publicDir, "apple-touch-icon.png"), render(180));

console.log("icons written to", publicDir);
