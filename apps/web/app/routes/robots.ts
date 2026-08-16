import { publicOrigin } from "~/lib/origin.server";
import type { Route } from "./+types/robots";

/**
 * Nothing is disallowed: every page here is public, server rendered and meant to
 * be indexed, which is the reason this project exists. The alias routes answer
 * with a redirect rather than a page, so they need no rule of their own.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const body = `User-agent: *
Allow: /

Sitemap: ${publicOrigin(request)}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
