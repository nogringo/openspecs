import { parsePubkey } from "@openspecs/nostr";
import { data } from "react-router";
import { NOT_FOUND_HEADERS } from "~/lib/http";
import { loadSpec } from "~/lib/specs.server";
import type { Route } from "./+types/event";

/**
 * The signed event, verbatim, exactly as the relays serve it. This is the
 * document: the page is only one rendering of it, and anyone should be able to
 * take the event, check its signature and publish it elsewhere without asking.
 * Hence the open CORS header, on data that is public by construction.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const pubkey = parsePubkey(params.author);
  if (pubkey === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  const cached = await loadSpec(pubkey, params.identifier);
  if (cached === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  return Response.json(cached.event, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
    },
  });
}
