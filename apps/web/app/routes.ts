import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("specs", "routes/specs.tsx"),
  route("about", "routes/about.tsx"),
  route("settings", "routes/settings.tsx", [
    index("routes/settings/profile.tsx"),
    route("relays", "routes/settings/relays.tsx"),
    route("browser", "routes/settings/browser.tsx"),
    route("blocked", "routes/settings/blocked.tsx"),
  ]),
  route("connect", "routes/connect.tsx"),
  route("notifications", "routes/notifications.tsx"),
  route("new", "routes/new.tsx"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
  route("rss.xml", "routes/rss.ts"),
  route("atom.xml", "routes/atom.ts"),
  route("spec/:author/:identifier", "routes/spec.tsx"),
  route("spec/:author/:identifier/edit", "routes/spec-edit.tsx"),
  route("spec/:author/:identifier/fork", "routes/spec-fork.tsx"),
  route("spec/:author/:identifier/diff/:other", "routes/spec-diff.tsx", {
    id: "spec-diff",
  }),
  route("spec/:author/:identifier/diff/:other/:otherIdentifier", "routes/spec-diff.tsx", {
    id: "spec-diff-renamed",
  }),
  route("spec/:author/:identifier/event.json", "routes/event.ts"),
  route("og/:author/:identifier", "routes/og.ts"),
  route("og/:author", "routes/og-author.ts"),
  route("oembed", "routes/oembed.ts"),
  // Last, and at the root: an npub is the identity itself rather than something
  // this site files under a heading of its own. Every static path above is a
  // word, and no npub is, so the two can never mean the same thing.
  route(":author/rss.xml", "routes/author-rss.ts"),
  route(":author/atom.xml", "routes/author-atom.ts"),
  route(":author", "routes/author.tsx"),
] satisfies RouteConfig;
