import { keyColor, keyTextHex } from "./color";
import { KEY_MARK_GRID, keyMarkCells } from "./key-mark";
import { type Author, shortNpub } from "./profile";
import type { SpecPage } from "./specs.server";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Bump this whenever the card changes. A drawn card is cached under the event it
 * describes, but it depends just as much on the drawing: without this, a palette
 * or a layout fixed today would keep serving yesterday's picture forever.
 */
export const CARD_VERSION = 5;

/**
 * The light palette of app.css, written out: this tree is rendered by satori,
 * which knows nothing of CSS variables, of Tailwind, or of the reader's theme.
 */
const PAPER = "#fcfcfa";
const INK = "#15171c";
const MUTED = "#5c6270";
const RULE = "#e4e3dd";

const clamp = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Only the latin subset of the font is loaded, so text written in anything else
 * would be drawn as a row of boxes. Better to fall back to the key.
 */
const drawable = (text: string, max = 28): string => {
  const kept = text.replace(/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}]/gu, "").trim();
  return kept.length >= 2 ? clamp(kept, max) : "";
};

/**
 * The picture arrives as bytes the loader already read, never as a URL: satori
 * would fetch a URL itself, on a request an unfurler is waiting on. The mark is
 * what every author has, so it is what stands in when there are no bytes.
 */
const Face = ({
  pubkey,
  picture,
  cell,
}: {
  pubkey: string;
  picture: string | null;
  cell: number;
}) => {
  const size = cell * KEY_MARK_GRID;
  return picture === null ? (
    <Mark pubkey={pubkey} cell={cell} />
  ) : (
    <img
      src={picture}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: cell / 2, objectFit: "cover" }}
    />
  );
};

const Mark = ({ pubkey, cell = 12 }: { pubkey: string; cell?: number }) => {
  const color = keyColor(pubkey);
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

const Signature = ({ spec, author }: { spec: SpecPage; author: Author | null }) => {
  const name = drawable(author?.name ?? "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* The light correction, since the card is always drawn on paper. */}
      {name !== "" && (
        <div style={{ display: "flex", color: keyTextHex(spec.pubkey, "light") }}>{name}</div>
      )}
      <div style={{ display: "flex" }}>{shortNpub(spec.npub)}</div>
    </div>
  );
};

/**
 * One card, one document. Everything on it is read off the event, so an unfurled
 * link says the same things the page does: what the document is, who signed it,
 * and when.
 */
export const OgCard = ({
  spec,
  author,
  picture,
}: {
  spec: SpecPage;
  author: Author | null;
  picture: string | null;
}) => (
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
      <Face pubkey={spec.pubkey} picture={picture} cell={12} />
      <Signature spec={spec} author={author} />
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex" }}>{asDate(spec.publishedAt)}</div>
    </div>
  </div>
);

export type OgAuthor = {
  pubkey: string;
  npub: string;
  name: string;
  about: string;
  /** The picture as bytes, read by the loader rather than by the renderer. */
  picture: string | null;
  count: number;
};

/** One card, one author: their face, their name and the size of their shelf. */
export const OgAuthorCard = ({ author }: { author: OgAuthor }) => {
  const name = drawable(author.name);
  const about = drawable(author.about, 118);
  const documents = author.count === 1 ? "specification" : "specifications";

  return (
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
          fontSize: 22,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: MUTED,
        }}
      >
        Open Specs
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 64 }}>
        <Face pubkey={author.pubkey} picture={author.picture} cell={24} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {name !== "" && (
            <div
              style={{
                display: "flex",
                fontSize: 62,
                fontWeight: 500,
                lineClamp: 1,
                color: keyTextHex(author.pubkey, "light"),
              }}
            >
              {name}
            </div>
          )}
          {/* The key, larger when it is the only thing this author is named by. */}
          <div style={{ display: "flex", fontSize: name === "" ? 44 : 28, color: MUTED }}>
            {shortNpub(author.npub)}
          </div>
        </div>
      </div>

      {about !== "" && (
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 26,
            lineHeight: 1.45,
            color: MUTED,
            lineClamp: 2,
          }}
        >
          {about}
        </div>
      )}

      <div style={{ display: "flex", flexGrow: 1 }} />

      <div
        style={{
          display: "flex",
          paddingTop: 28,
          borderTop: `2px solid ${RULE}`,
          fontSize: 24,
          color: MUTED,
        }}
      >
        {`${author.count} ${documents}`}
      </div>
    </div>
  );
};
