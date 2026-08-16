import { feedResponse } from "~/lib/feed.server";
import type { Route } from "./+types/atom";

export async function loader({ request }: Route.LoaderArgs) {
  return feedResponse(request, "atom");
}
