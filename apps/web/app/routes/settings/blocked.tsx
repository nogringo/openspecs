import { BlockedList } from "~/components/settings/blocked-list";
import { PAGE_HEADERS } from "~/lib/http";
import type { Route } from "./+types/blocked";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Blocked | Open Specs" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * What this reader chose not to see. A tab of its own rather than a heading
 * under the browser's settings: the list is this browser's until a key is
 * connected and that key's afterwards, so it belongs to neither page, and it
 * needs neither a key nor an open one to be read.
 */
export default function BlockedSettings() {
  return <BlockedList />;
}
