/**
 * A colour per key, derived from the key. Two people on Nostr can publish the
 * same name and differ only by their npub, and a thread where both are called
 * alice reads as one person talking to themselves. The colour is what tells
 * them apart at a glance.
 *
 * The rules are the string-color protocol, kind 30818 `d:string-color`, so a
 * key is the same colour here as in any other client that implements it. Only
 * the hex-string half is written: this site colours keys, and the polynomial
 * hash for arbitrary strings has nothing to derive here.
 */

type Rgb = [number, number, number];

/** What the protocol falls back to for an input it cannot read. */
const GREY: Rgb = [128, 128, 128];

const SATURATION = 0.7;

/**
 * Value follows the hue because the eye does: the yellows and greens are already
 * bright and would glare, the blues read dark and need lifting.
 */
const value = (hue: number): number => {
  if (hue >= 32 && hue <= 204) return 0.75;
  if (hue >= 216 && hue <= 273) return 0.96;
  return 0.9;
};

const fromHue = (hue: number): Rgb => {
  const v = value(hue);
  const h = hue / 60;
  const c = v * SATURATION;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;

  const sector = Math.floor(h);
  const [r, g, b]: Rgb =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

/**
 * The whole key feeds the hue, read as one number rather than hashed: a pubkey
 * is already uniformly distributed, so there is nothing left for a hash to do.
 */
const hexColor = (hex: string): Rgb => {
  const clean = hex.trim();
  if (!/^[0-9a-f]+$/i.test(clean)) return GREY;
  return fromHue(Number(BigInt(`0x${clean}`) % 360n));
};

export type ColorMode = "light" | "dark";

/**
 * The same colour has to survive two grounds. Lifted on dark paper and pulled
 * down on light, which is the correction the protocol asks for when the colour
 * is text rather than a shape.
 */
const asText = ([r, g, b]: Rgb, mode: ColorMode): Rgb => {
  const factor = mode === "dark" ? 1.08 : 0.95;
  const channel = (level: number) => Math.min(255, Math.max(0, Math.round(level * factor)));
  return [channel(r), channel(g), channel(b)];
};

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/** The key's colour as it is, for a mark or any other shape rather than text. */
export const keyColor = (pubkey: string): string => toHex(hexColor(pubkey));

/** One half of the pair, for a renderer that resolves no CSS of its own. */
export const keyTextHex = (pubkey: string, mode: ColorMode): string =>
  toHex(asText(hexColor(pubkey), mode));

/**
 * Both corrections in one value, left to the browser to pick between: the page
 * flips theme on a media query, and a name must not need re-rendering to follow.
 */
export const keyTextColor = (pubkey: string): string =>
  `light-dark(${keyTextHex(pubkey, "light")}, ${keyTextHex(pubkey, "dark")})`;
