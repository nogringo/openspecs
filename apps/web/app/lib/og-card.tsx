import { oklchToHex } from "./color";
import { keyMarkCells, keyMarkHue } from "./key-mark";
import type { SpecPage } from "./specs.server";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Bump this whenever the card changes. A drawn card is cached under the event it
 * describes, but it depends just as much on the drawing: without this, a palette
 * or a layout fixed today would keep serving yesterday's picture forever.
 */
export const CARD_VERSION = 2;

/**
 * The light palette of app.css, written out: this tree is rendered by satori,
 * which knows nothing of CSS variables, of Tailwind, or of the reader's theme.
 */
const PAPER = "#fcfcfa";
const INK = "#15171c";
const MUTED = "#5c6270";
const RULE = "#e4e3dd";

const clamp = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}...`;

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

const shortNpub = (npub: string): string => `${npub.slice(0, 12)}...${npub.slice(-6)}`;

const Mark = ({ pubkey, cell = 12 }: { pubkey: string; cell?: number }) => {
  // The light theme of the mark, since the card is always drawn on paper.
  const color = oklchToHex(0.55, 0.13, keyMarkHue(pubkey));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {keyMarkCells(pubkey).map((cells, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the index is the cell's coordinate
        <div key={`${pubkey}-${row}`} style={{ display: "flex" }}>
          {cells.map((filled, column) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the cell's coordinate
              key={`${pubkey}-${row}-${column}`}
              style={{
                width: cell,
                height: cell,
                backgroundColor: filled ? color : "transparent",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * One card, one document. Everything on it is read off the event, so an unfurled
 * link says the same things the page does: what the document is, who signed it,
 * and when.
 */
export const OgCard = ({ spec }: { spec: SpecPage }) => (
  <div
    style={{
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      flexDirection: "column",
      backgroundColor: PAPER,
      color: INK,
      padding: "60px 72px",
      fontFamily: "JetBrains Mono",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 22,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: MUTED,
      }}
    >
      <div style={{ display: "flex" }}>Open Specs</div>
      {spec.status !== null && <div style={{ display: "flex" }}>{clamp(spec.status, 24)}</div>}
    </div>

    <div style={{ display: "flex", marginTop: 52, fontSize: 24, color: MUTED }}>
      {`${spec.kind}:${clamp(spec.identifier, 48)}`}
    </div>

    <div
      style={{
        display: "flex",
        marginTop: 18,
        fontSize: 58,
        fontWeight: 500,
        lineHeight: 1.15,
        lineClamp: 3,
      }}
    >
      {clamp(spec.title, 110)}
    </div>

    {spec.summary !== "" && (
      <div
        style={{
          display: "flex",
          marginTop: 26,
          fontSize: 26,
          lineHeight: 1.45,
          color: MUTED,
          lineClamp: 2,
        }}
      >
        {clamp(spec.summary, 118)}
      </div>
    )}

    <div style={{ display: "flex", flexGrow: 1 }} />

    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        paddingTop: 28,
        borderTop: `2px solid ${RULE}`,
        fontSize: 24,
        color: MUTED,
      }}
    >
      <Mark pubkey={spec.pubkey} />
      <div style={{ display: "flex" }}>{shortNpub(spec.npub)}</div>
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex" }}>{asDate(spec.publishedAt)}</div>
    </div>
  </div>
);
