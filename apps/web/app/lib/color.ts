const gamma = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const hex = (channel: number): string =>
  Math.round(Math.min(1, Math.max(0, gamma(channel))) * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * The page states its colours in oklch, which satori cannot read, so the card
 * converts them itself rather than approximating: an author's mark has to be the
 * same colour in a browser and in an unfurled link. Björn Ottosson's transform,
 * oklch to oklab to linear sRGB to sRGB.
 */
export const oklchToHex = (lightness: number, chroma: number, hue: number): string => {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return `#${hex(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short)}${hex(
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
  )}${hex(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short)}`;
};
