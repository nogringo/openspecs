import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("specs", "routes/specs.tsx"),
  route("settings", "routes/settings.tsx"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
  route("rss.xml", "routes/rss.ts"),
  route("atom.xml", "routes/atom.ts"),
  route("spec/:author/:identifier", "routes/spec.tsx"),
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
