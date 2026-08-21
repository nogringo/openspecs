import { useEffect, useState } from "react";

type Matrix = { size: number; filled: boolean[][] };

/**
 * Drawn as one path of squares rather than an image: it inherits the page's ink,
 * so it is legible in both themes without a second version of anything, and it
 * stays sharp at whatever size it is given.
 */
export const Qr = ({ value, size = 220 }: { value: string; size?: number }) => {
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    let current = true;
    void import("uqr").then(({ encode }) => {
      const encoded = encode(value, { ecc: "M" });
      if (current) setMatrix({ size: encoded.size, filled: encoded.data });
    });
    return () => {
      current = false;
    };
  }, [value]);

  if (matrix === null) {
    return <div style={{ width: size, height: size }} className="rounded-sm bg-shade" />;
  }

  const cells: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.filled[row]?.[column]) cells.push(`M${column} ${row}h1v1h-1z`);
    }
  }

  return (
    <svg
      viewBox={`-1 -1 ${matrix.size + 2} ${matrix.size + 2}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Scan this with your signer"
      className="rounded-sm bg-paper"
    >
      <title>Scan this with your signer</title>
      <path d={cells.join("")} fill="currentColor" />
    </svg>
  );
};
