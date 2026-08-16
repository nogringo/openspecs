import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("specs", "routes/specs.tsx"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
  route("spec/:author/:identifier", "routes/spec.tsx"),
  route(":address", "routes/address.tsx"),
] satisfies RouteConfig;
