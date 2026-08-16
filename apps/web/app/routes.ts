import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("spec/:author/:identifier", "routes/spec.tsx"),
] satisfies RouteConfig;
