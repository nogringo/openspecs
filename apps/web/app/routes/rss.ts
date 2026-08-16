import { feedResponse } from "~/lib/feed.server";
import type { Route } from "./+types/rss";

export async function loader({ request }: Route.LoaderArgs) {
  return feedResponse(request, "rss");
}
