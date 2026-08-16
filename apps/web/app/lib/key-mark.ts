export const KEY_MARK_GRID = 5;

const byteAt = (hex: string, index: number): number =>
  Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) || 0;

/**
 * The same mark wherever a key appears, drawn from the key itself: three columns
 * decided by the first bytes, mirrored into five. The hue comes from bytes the
 * grid does not read, so two authors with a similar pattern rarely share a colour.
 */
export const keyMarkCells = (pubkey: string): boolean[][] => {
  const rows: boolean[][] = [];
  for (let row = 0; row < KEY_MARK_GRID; row++) {
    const cells: boolean[] = [];
    for (let column = 0; column < KEY_MARK_GRID; column++) {
      const mirrored = Math.min(column, KEY_MARK_GRID - 1 - column);
      cells.push(byteAt(pubkey, mirrored * KEY_MARK_GRID + row) % 2 === 0);
    }
    rows.push(cells);
  }
  return rows;
};

export const keyMarkHue = (pubkey: string): number =>
  (byteAt(pubkey, 30) * 256 + byteAt(pubkey, 31)) % 360;
