import { useState } from "react";
import { KeyMark } from "./key-mark";

/**
 * The picture is loaded from whatever host the author named. That is a request
 * this page makes on the reader's behalf, which cited links are deliberately not
 * given: an author is the subject of their own document rather than a third
 * party it points at, and `no-referrer` withholds which page is being read.
 *
 * The mark is what every author has, published profile or not, so it is what a
 * missing or broken picture falls back to.
 */
export const AuthorAvatar = ({
  pubkey,
  picture,
  size = 44,
}: {
  pubkey: string;
  picture: string | null;
  size?: number;
}) => {
  const [broken, setBroken] = useState(false);
  if (picture === null || broken) return <KeyMark pubkey={pubkey} size={size} />;

  return (
    <img
      // Decorative: the name and the key that owns it are the text beside it.
      alt=""
      src={picture}
      width={size}
      height={size}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      // This markup is rendered by the server, so a picture can fail before any
      // handler is attached: the outcome is read back rather than waited for.
      ref={(node) => {
        if (node?.complete && node.naturalWidth === 0) setBroken(true);
      }}
      className="shrink-0 rounded-sm object-cover"
      style={{ width: size, height: size }}
    />
  );
};
