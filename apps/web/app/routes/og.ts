import { parsePubkey } from "@openspecs/nostr";
import { data } from "react-router";
import { NOT_FOUND_HEADERS } from "~/lib/http";
import { ogImage } from "~/lib/og.server";
import { loadSpec } from "~/lib/specs.server";
import type { Route } from "./+types/og";

/**
 * Only the canonical npub form draws a card. The page redirects every other way
 * of naming an author, and an unfurler reads the URL the page hands it.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const pubkey = parsePubkey(params.author);
  if (pubkey === null || params.author.startsWith("npub1") === false) {
    throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const cached = await loadSpec(pubkey, params.identifier);
  if (cached === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  // Copied out of the renderer's memory, which WebAssembly is free to reuse.
  return new Response(new Uint8Array(await ogImage(cached.page)), {
    headers: {
      "Content-Type": "image/png",
      // Named after a revision that cannot change, so it is cached for a week.
      "Cache-Control": "public, max-age=0, s-maxage=604800, stale-while-revalidate=604800",
    },
  });
}
