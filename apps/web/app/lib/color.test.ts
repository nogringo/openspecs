import { describe, expect, it } from "vitest";
import { oklchToHex } from "./color";

describe("oklchToHex", () => {
  it("writes a hex colour", () => {
    expect(oklchToHex(0.55, 0.13, 37)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps white white and black black", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
  });

  it("puts each hue in the family it belongs to", () => {
    const channels = (color: string) => [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];

    const [redR, redG, redB] = channels(oklchToHex(0.55, 0.13, 25));
    expect(redR).toBeGreaterThan(redG as number);
    expect(redR).toBeGreaterThan(redB as number);

    const [greenR, greenG, greenB] = channels(oklchToHex(0.55, 0.13, 145));
    expect(greenG).toBeGreaterThan(greenR as number);
    expect(greenG).toBeGreaterThan(greenB as number);

    const [blueR, blueG, blueB] = channels(oklchToHex(0.55, 0.13, 265));
    expect(blueB).toBeGreaterThan(blueR as number);
    expect(blueB).toBeGreaterThan(blueG as number);
  });

  it("stays inside the range a screen can show", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const color = oklchToHex(0.55, 0.13, hue);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
