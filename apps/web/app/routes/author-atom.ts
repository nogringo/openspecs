import { authorFeedResponse } from "~/lib/feed.server";
import type { Route } from "./+types/author-atom";

export async function loader({ params, request }: Route.LoaderArgs) {
  return authorFeedResponse(request, params.author, "atom");
}
