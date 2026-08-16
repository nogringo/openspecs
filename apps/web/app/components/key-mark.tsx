const GRID = 5;

const byteAt = (hex: string, index: number): number =>
  Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) || 0;

/**
 * The author's key drawn as a mark. No profile is fetched yet, and one npub
 * looks like every other npub, so the identity is given a shape derived from
 * the key itself: same author, same mark, on any page and in any client.
 */
export const KeyMark = ({ pubkey, size = 44 }: { pubkey: string; size?: number }) => {
  const hue = (byteAt(pubkey, 30) * 256 + byteAt(pubkey, 31)) % 360;
  const cells: Array<[number, number]> = [];
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < GRID; row++) {
      if (byteAt(pubkey, column * GRID + row) % 2 !== 0) continue;
      cells.push([column, row]);
      if (column < 2) cells.push([GRID - 1 - column, row]);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      width={size}
      height={size}
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ color: `light-dark(oklch(0.55 0.13 ${hue}), oklch(0.74 0.13 ${hue}))` }}
    >
      {cells.map(([column, row]) => (
        <rect
          key={`${column}-${row}`}
          x={column}
          y={row}
          width="1"
          height="1"
          fill="currentColor"
        />
      ))}
    </svg>
  );
};
