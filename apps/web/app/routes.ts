import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("specs", "routes/specs.tsx"),
  route("spec/:author/:identifier", "routes/spec.tsx"),
  route(":address", "routes/address.tsx"),
] satisfies RouteConfig;
