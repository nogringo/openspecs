import { describe, expect, it } from "vitest";
import { KEY_MARK_GRID, keyMarkCells } from "./key-mark";

const PUBKEY = "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";
const OTHER = "e5272de914bd301755c439b88e6959a43c9d2ee20c7c849e28f4e79994b50817";

describe("keyMarkCells", () => {
  it("draws a square of the announced size", () => {
    const rows = keyMarkCells(PUBKEY);
    expect(rows).toHaveLength(KEY_MARK_GRID);
    for (const row of rows) expect(row).toHaveLength(KEY_MARK_GRID);
  });

  it("mirrors every row, which is what makes the mark read as a mark", () => {
    for (const row of keyMarkCells(PUBKEY)) {
      expect(row[0]).toBe(row[4]);
      expect(row[1]).toBe(row[3]);
    }
  });

  it("draws the same mark for the same key, a different one for another", () => {
    expect(keyMarkCells(PUBKEY)).toEqual(keyMarkCells(PUBKEY));
    expect(keyMarkCells(PUBKEY)).not.toEqual(keyMarkCells(OTHER));
  });

  // Two keys sharing a shape are told apart by the colour, which reads the whole
  // key rather than the fifteen bytes the grid stops at.
  it("reads only the bytes it draws with", () => {
    expect(keyMarkCells(`${PUBKEY.slice(0, 60)}0000`)).toEqual(keyMarkCells(PUBKEY));
  });
});
