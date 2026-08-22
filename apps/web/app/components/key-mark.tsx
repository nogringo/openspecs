import { keyColor } from "~/lib/color";
import { KEY_MARK_GRID, keyMarkCells } from "~/lib/key-mark";

/**
 * The author's key drawn as a mark. No profile is fetched yet, and one npub
 * looks like every other npub, so the identity is given a shape derived from
 * the key itself: same author, same mark, on any page and in any client.
 *
 * Filled with the colour their name is written in, so the face and the name
 * agree even before the profile arrives. A shape is not text, and the protocol
 * asks for no readability correction on one.
 */
export const KeyMark = ({ pubkey, size = 44 }: { pubkey: string; size?: number }) => {
  const rows = keyMarkCells(pubkey);

  return (
    <svg
      viewBox={`0 0 ${KEY_MARK_GRID} ${KEY_MARK_GRID}`}
      width={size}
      height={size}
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ color: keyColor(pubkey) }}
    >
      {rows.map((cells, row) =>
        cells.map((filled, column) =>
          filled ? (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the cell's coordinate
              key={`${row}-${column}`}
              x={column}
              y={row}
              width="1"
              height="1"
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </svg>
  );
};
