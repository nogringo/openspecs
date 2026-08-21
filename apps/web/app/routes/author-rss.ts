import { authorFeedResponse } from "~/lib/feed.server";
import type { Route } from "./+types/author-rss";

export async function loader({ params, request }: Route.LoaderArgs) {
  return authorFeedResponse(request, params.author, "rss");
}
