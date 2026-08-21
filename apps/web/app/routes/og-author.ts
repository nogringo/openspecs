import { parsePubkey } from "@openspecs/nostr";
import { data } from "react-router";
import { NOT_FOUND_HEADERS } from "~/lib/http";
import { authorOgImage } from "~/lib/og.server";
import { loadAuthor } from "~/lib/profile.server";
import { loadAuthorSpecs } from "~/lib/specs.server";
import type { Route } from "./+types/og-author";

/**
 * Only the canonical npub form draws a card. The page redirects every other way
 * of naming an author, and an unfurler reads the URL the page hands it.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const npub = params.author;
  const pubkey = npub.startsWith("npub1") ? parsePubkey(npub) : null;
  if (pubkey === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  const [author, specs] = await Promise.all([loadAuthor(pubkey), loadAuthorSpecs(pubkey)]);
  if (author === null && specs.length === 0) {
    throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }

  // The card falls back to the key on its own, so an unnamed author stays unnamed.
  const card = {
    pubkey,
    npub,
    name: author?.name ?? "",
    about: author?.about ?? "",
    count: specs.length,
  };

  // Copied out of the renderer's memory, which WebAssembly is free to reuse.
  return new Response(new Uint8Array(await authorOgImage(card, author)), {
    headers: {
      "Content-Type": "image/png",
      // Redrawn as soon as the profile or the shelf changes, since both are in
      // the name it is cached under, so a day is a day of nothing changing.
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
