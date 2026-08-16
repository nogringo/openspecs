import { parsePubkey } from "@openspecs/nostr";
import { data } from "react-router";
import { NOT_FOUND_HEADERS } from "~/lib/http";
import { parseSpecUrl } from "~/lib/oembed";
import { OG_HEIGHT, OG_WIDTH } from "~/lib/og-card";
import { publicOrigin } from "~/lib/origin.server";
import { ogImagePath } from "~/lib/paths";
import { loadSpec } from "~/lib/specs.server";
import type { Route } from "./+types/oembed";

const CACHE_AGE_SECONDS = 3600;

/**
 * Type `link` rather than `rich`: a specification is a document to be read at
 * its own address, and handing an embedder an iframe of it would only make a
 * worse copy of the page.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;

  const format = params.get("format") ?? "json";
  if (format !== "json") throw data(`Format ${format} is not available`, { status: 501 });

  const origin = publicOrigin(request);
  const target = parseSpecUrl(params.get("url") ?? "", origin);
  const pubkey = target === null ? null : parsePubkey(target.npub);
  if (target === null || pubkey === null) {
    throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const cached = await loadSpec(pubkey, target.identifier);
  if (cached === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  return Response.json(
    {
      version: "1.0",
      type: "link",
      title: cached.page.title,
      author_name: cached.page.npub,
      provider_name: "Open Specs",
      provider_url: `${origin}/`,
      thumbnail_url: `${origin}${ogImagePath(cached.page.npub, cached.page.identifier)}`,
      thumbnail_width: OG_WIDTH,
      thumbnail_height: OG_HEIGHT,
      cache_age: CACHE_AGE_SECONDS,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
      },
    },
  );
}
