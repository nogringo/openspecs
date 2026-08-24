import { Alerts } from "~/components/settings/alerts";
import { ClientTag } from "~/components/settings/client-tag";
import { PAGE_HEADERS } from "~/lib/http";
import type { Route } from "./+types/browser";

export function meta(_: Route.MetaArgs) {
  return [{ title: "This browser | Open Specs" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * Settings of this browser rather than of a key: nothing here is published, and
 * nothing here needs a key to be connected or open. Which is why it is a tab of
 * its own, and not a heading somebody has to scroll past a profile to reach.
 */
export default function BrowserSettings() {
  return (
    <div className="space-y-12">
      <Alerts />
      <ClientTag />
    </div>
  );
}
