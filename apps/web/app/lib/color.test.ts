import { describe, expect, it } from "vitest";
import { keyColor, keyTextColor, keyTextHex } from "./color";

const PUBKEY = "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";
const OTHER = "e5272de914bd301755c439b88e6959a43c9d2ee20c7c849e28f4e79994b50817";

const channels = (color: string): number[] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

describe("keyColor", () => {
  it("gives the same key the same colour, and another key another", () => {
    expect(keyColor(PUBKEY)).toBe(keyColor(PUBKEY));
    expect(keyColor(PUBKEY)).not.toBe(keyColor(OTHER));
  });

  it("writes a hex colour for every key", () => {
    for (const pubkey of [PUBKEY, OTHER, "f".repeat(64), "0".repeat(64)]) {
      expect(keyColor(pubkey)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The hue is the whole key read as one number, so these are the protocol's
  // own arithmetic: 0x3c is hue 60, 0xf0 is hue 240, 0x0 is hue 0.
  it("follows the protocol at each step of the value ladder", () => {
    expect(keyColor("0")).toBe("#e64545");
    expect(keyColor("3c")).toBe("#bfbf39");
    expect(keyColor("f0")).toBe("#4949f5");
  });

  it("puts each hue in the family it belongs to", () => {
    const [redR, redG, redB] = channels(keyColor("0"));
    expect(redR).toBeGreaterThan(redG as number);
    expect(redR).toBeGreaterThan(redB as number);

    const [greenR, greenG, greenB] = channels(keyColor("78"));
    expect(greenG).toBeGreaterThan(greenR as number);
    expect(greenG).toBeGreaterThan(greenB as number);

    const [blueR, blueG, blueB] = channels(keyColor("f0"));
    expect(blueB).toBeGreaterThan(blueR as number);
    expect(blueB).toBeGreaterThan(blueG as number);
  });

  it("falls back to grey for what is not a key", () => {
    expect(keyColor("")).toBe("#808080");
    expect(keyColor("   ")).toBe("#808080");
    expect(keyColor("npub1zzz")).toBe("#808080");
  });
});

describe("keyTextHex", () => {
  it("lifts the colour on dark paper and pulls it down on light", () => {
    const plain = channels(keyColor(PUBKEY));
    const light = channels(keyTextHex(PUBKEY, "light"));
    const dark = channels(keyTextHex(PUBKEY, "dark"));

    for (const index of [0, 1, 2]) {
      expect(light[index]).toBeLessThanOrEqual(plain[index] as number);
      expect(dark[index]).toBeGreaterThanOrEqual(plain[index] as number);
    }
  });

  it("keeps every channel on the scale a screen can show", () => {
    for (const hue of ["0", "3c", "78", "b4", "f0", "14a"]) {
      for (const channel of channels(keyTextHex(hue, "dark"))) {
        expect(channel).toBeLessThanOrEqual(255);
        expect(channel).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("keyTextColor", () => {
  it("carries both corrections, for the browser to choose between", () => {
    expect(keyTextColor(PUBKEY)).toBe(
      `light-dark(${keyTextHex(PUBKEY, "light")}, ${keyTextHex(PUBKEY, "dark")})`,
    );
  });
});
