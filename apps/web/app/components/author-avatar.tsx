import { blobHash, blobUrls, DEFAULT_BLOSSOM_SERVERS } from "@openspecs/nostr";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { serverServersState, serversState, subscribeServers, wantServers } from "~/lib/servers";
import { KeyMark } from "./key-mark";

/**
 * The picture is loaded from whatever host the author named. That is a request
 * this page makes on the reader's behalf, which cited links are deliberately not
 * given: an author is the subject of their own document rather than a third
 * party it points at, and `no-referrer` withholds which page is being read.
 *
 * A profile names one address, and an address is a place rather than a thing: the
 * server behind it fills up, goes away, or decides it would rather not host this
 * author, and every page drawing them is left with a hole. So when a picture
 * fails and its address is a Blossom one, the hash is taken out of it and the
 * same blob is asked for on the other servers that author names. That is what
 * BUD-03 is for, and it is the half that makes uploading to four of them worth
 * anything.
 *
 * The mark is what every author has, published profile or not, so it is what a
 * picture nothing can find falls back to.
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
  // Which addresses failed, rather than that one did: this is drawn beside a
  // field somebody is typing an address into, and a mark latched on for the
  // address before the one on screen would call the new one broken untried.
  const [failed, setFailed] = useState<string[]>([]);

  const known = useSyncExternalStore(subscribeServers, serversState, serverServersState);
  const elsewhere = picture === null ? undefined : known[pubkey];

  const candidates = useMemo(() => {
    if (picture === null) return [];
    if (elsewhere === undefined) return [picture];
    // An author who named none still gets the well-known servers tried, which is
    // what BUD-03 says to do and costs nothing until a picture has already gone.
    return [
      picture,
      ...blobUrls(picture, elsewhere.length > 0 ? elsewhere : DEFAULT_BLOSSOM_SERVERS),
    ];
  }, [picture, elsewhere]);

  const src = candidates.find((url) => !failed.includes(url)) ?? null;

  // Only once everything known has failed, so a page whose pictures all load
  // never asks at all.
  useEffect(() => {
    if (src === null && picture !== null && blobHash(picture) !== null) wantServers([pubkey]);
  }, [src, picture, pubkey]);

  if (src === null) return <KeyMark pubkey={pubkey} size={size} />;

  return (
    <img
      // A fresh element per address, so the load below reads this one's outcome
      // rather than the previous one's.
      key={src}
      // Decorative: the name and the key that owns it are the text beside it.
      alt=""
      src={src}
      width={size}
      height={size}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed((gone) => [...gone, src])}
      // This markup is rendered by the server, so a picture can fail before any
      // handler is attached: the outcome is read back rather than waited for.
      ref={(node) => {
        if (node?.complete && node.naturalWidth === 0) setFailed((gone) => [...gone, src]);
      }}
      className="shrink-0 rounded-sm object-cover"
      style={{ width: size, height: size }}
    />
  );
};
